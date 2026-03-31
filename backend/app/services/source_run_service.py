"""Resolve logical vehicles to their active telemetry streams."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Optional, TypeVar
import re

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.telemetry import TelemetryCurrent, TelemetryData, TelemetryMetadata, TelemetrySource, TelemetryStream
from telemetry_catalog.builtins import DROGONSAT_SOURCE_ID, RHAEGALSAT_SOURCE_ID
from telemetry_catalog.definitions import resolve_source_id_alias

ACTIVE_STREAM_CACHE_TTL_SEC = 30.0
SIMULATOR_STATUS_CACHE_TTL_SEC = 2.0
_active_stream_by_vehicle: dict[str, tuple[str, float]] = {}
_simulator_status_by_vehicle: dict[str, tuple[dict[str, object], float]] = {}
_stream_owner_by_stream: dict[str, tuple[str, float]] = {}
RUN_ID_RE = re.compile(r"^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?)$")
T = TypeVar("T")


class StreamIdConflictError(ValueError):
    """Raised when a stream id collides with a reserved vehicle id."""


class SourceNotFoundError(ValueError):
    """Raised when stream registration targets an unknown logical vehicle."""


def normalize_vehicle_id(vehicle_id: str) -> str:
    """Normalize an exact vehicle id alias to its stored id."""
    return resolve_source_id_alias(vehicle_id) or vehicle_id


def normalize_source_id(source_id: str) -> str:
    """Backward-compatible wrapper for vehicle ids."""
    return normalize_vehicle_id(source_id)


def run_id_to_source_id(source_id: str) -> str:
    """Backward-compatible wrapper for older logical-source callers."""
    match = RUN_ID_RE.match(source_id)
    if not match:
        return normalize_vehicle_id(source_id)
    prefix = match.group(1)
    if prefix.startswith("simulator-"):
        return resolve_source_id_alias("simulator") or "simulator"
    if prefix.startswith("simulator2-"):
        return resolve_source_id_alias("simulator2") or "simulator2"
    if prefix == DROGONSAT_SOURCE_ID or prefix.startswith(f"{DROGONSAT_SOURCE_ID}-"):
        return DROGONSAT_SOURCE_ID
    if prefix == RHAEGALSAT_SOURCE_ID or prefix.startswith(f"{RHAEGALSAT_SOURCE_ID}-"):
        return RHAEGALSAT_SOURCE_ID
    return resolve_source_id_alias(prefix) or prefix


def resolve_logical_vehicle_id(db: Session | None, source_id: str) -> str:
    """Resolve either a vehicle id or a stream id to the owning logical vehicle."""
    if db is None:
        return run_id_to_source_id(source_id)
    return get_stream_vehicle_id(db, source_id) or run_id_to_source_id(source_id)


def ensure_stream_belongs_to_vehicle(
    db: Session,
    vehicle_id: str,
    stream_id: str | None = None,
) -> str:
    """Return a vehicle or stream id only if it belongs to the scoped logical vehicle."""
    logical_vehicle_id = normalize_vehicle_id(vehicle_id)
    if not stream_id:
        return logical_vehicle_id
    owning_vehicle_id = get_stream_vehicle_id(db, stream_id)
    if owning_vehicle_id != logical_vehicle_id:
        raise ValueError("Run not found for source")
    return stream_id


def ensure_run_belongs_to_source(db: Session, source_id: str, run_id: str | None = None) -> str:
    """Backward-compatible wrapper for older route guards."""
    return ensure_stream_belongs_to_vehicle(db, source_id, run_id)


def get_stream_vehicle_id(db: Session | None, stream_id: str) -> Optional[str]:
    """Resolve a stream id to its owning vehicle, if known."""
    cached_vehicle_id = _get_cached_stream_vehicle_id(stream_id)
    if db is None:
        return cached_vehicle_id

    row = db.get(TelemetryStream, stream_id)
    if row is not None:
        _cache_stream_owner(stream_id, row.vehicle_id)
        return row.vehicle_id
    if cached_vehicle_id is not None:
        return cached_vehicle_id
    vehicle_id = (
        db.execute(
            select(TelemetryMetadata.vehicle_id)
            .join(TelemetryCurrent, TelemetryCurrent.telemetry_id == TelemetryMetadata.id)
            .where(TelemetryCurrent.source_id == stream_id)
            .distinct()
        )
        .scalars()
        .first()
    )
    if vehicle_id is not None:
        _cache_stream_owner(stream_id, vehicle_id)
        return vehicle_id

    vehicle_id = (
        db.execute(
            select(TelemetryMetadata.vehicle_id)
            .join(TelemetryData, TelemetryData.telemetry_id == TelemetryMetadata.id)
            .where(TelemetryData.source_id == stream_id)
            .distinct()
        )
        .scalars()
        .first()
    )
    if vehicle_id is not None:
        _cache_stream_owner(stream_id, vehicle_id)
    return vehicle_id


def _cache_stream_owner(stream_id: str, vehicle_id: str, *, seen_at: float | None = None) -> None:
    _stream_owner_by_stream[stream_id] = (vehicle_id, seen_at if seen_at is not None else time.time())


def _get_cached_stream_vehicle_id(
    stream_id: str,
    *,
    max_age_sec: float = ACTIVE_STREAM_CACHE_TTL_SEC,
) -> Optional[str]:
    now = time.time()
    cached = _stream_owner_by_stream.get(stream_id)
    if cached is None:
        return None
    vehicle_id, seen_at = cached
    if now - seen_at > max_age_sec:
        _stream_owner_by_stream.pop(stream_id, None)
        return None
    return vehicle_id


def _cache_simulator_status(
    vehicle_id: str,
    *,
    state: str,
    active_stream_id: str | None,
    packet_source: str | None = None,
    receiver_id: str | None = None,
    seen_at: float | None = None,
) -> None:
    logical_vehicle_id = normalize_vehicle_id(vehicle_id)
    _simulator_status_by_vehicle[logical_vehicle_id] = (
        {
            "state": state,
            "active_stream_id": active_stream_id,
            "packet_source": packet_source,
            "receiver_id": receiver_id,
        },
        seen_at if seen_at is not None else time.time(),
    )


def _get_ttl_cache_entry(
    cache: dict[str, tuple[T, float]],
    key: str,
    *,
    ttl_sec: float,
) -> Optional[tuple[T, float]]:
    """Return a TTL-governed cache entry or evict it if expired."""
    cached = cache.get(key)
    if cached is None:
        return None
    value, seen_at = cached
    if time.time() - seen_at > ttl_sec:
        cache.pop(key, None)
        return None
    return value, seen_at


def _get_cached_simulator_status_entry(vehicle_id: str) -> Optional[tuple[dict[str, object], float]]:
    logical_vehicle_id = normalize_vehicle_id(vehicle_id)
    return _get_ttl_cache_entry(
        _simulator_status_by_vehicle,
        logical_vehicle_id,
        ttl_sec=SIMULATOR_STATUS_CACHE_TTL_SEC,
    )


def _get_cached_simulator_status(vehicle_id: str) -> Optional[dict[str, object]]:
    cached = _get_cached_simulator_status_entry(vehicle_id)
    if cached is None:
        return None
    return cached[0]


def _should_refresh_simulator_status(
    vehicle_id: str,
    *,
    min_poll_interval_sec: float = SIMULATOR_STATUS_CACHE_TTL_SEC,
) -> bool:
    """Return True when the next simulator /status call should be refreshed."""
    logical_vehicle_id = normalize_vehicle_id(vehicle_id)
    cached = _simulator_status_by_vehicle.get(logical_vehicle_id)
    if cached is None:
        return True
    _status, seen_at = cached
    return (time.time() - seen_at) > min_poll_interval_sec


def get_logical_source(db: Session, vehicle_id: str) -> Optional[TelemetrySource]:
    """Return the logical vehicle row."""
    return db.get(TelemetrySource, normalize_vehicle_id(vehicle_id))


def register_stream(
    db: Session,
    *,
    vehicle_id: str,
    stream_id: str,
    packet_source: str | None = None,
    receiver_id: str | None = None,
    started_at: datetime | None = None,
    seen_at: datetime | None = None,
    activate: bool = True,
) -> TelemetryStream:
    """Create or update a telemetry stream row and optionally mark it active in cache."""
    logical_vehicle_id = normalize_vehicle_id(vehicle_id)
    source = db.get(TelemetrySource, logical_vehicle_id)
    if source is None:
        raise SourceNotFoundError(f"Source not found: {logical_vehicle_id}")

    reserved_vehicle_id = normalize_vehicle_id(stream_id)
    existing_vehicle = db.get(TelemetrySource, reserved_vehicle_id)
    if existing_vehicle is not None and reserved_vehicle_id != logical_vehicle_id:
        raise StreamIdConflictError("stream_id conflicts with an existing vehicle id")

    observed_at = seen_at or started_at or datetime.now(timezone.utc)
    started_at = started_at or observed_at
    stream = db.get(TelemetryStream, stream_id)
    if stream is None:
        db.execute(
            pg_insert(TelemetryStream)
            .values(
                id=stream_id,
                vehicle_id=logical_vehicle_id,
                packet_source=packet_source,
                receiver_id=receiver_id,
                status="active" if activate else "idle",
                started_at=started_at,
                last_seen_at=observed_at,
            )
            .on_conflict_do_nothing(index_elements=[TelemetryStream.id])
        )
        stream = db.get(TelemetryStream, stream_id)
    if stream is None:
        raise RuntimeError("Telemetry stream registration failed")
    if stream.vehicle_id != logical_vehicle_id:
        raise StreamIdConflictError("stream_id does not belong to vehicle")
    stream.vehicle_id = logical_vehicle_id
    if activate:
        stream.status = "active"
    elif getattr(stream, "status", None) is None:
        stream.status = "idle"
    if getattr(stream, "started_at", None) is None:
        stream.started_at = started_at
    stream.last_seen_at = observed_at
    if packet_source is not None:
        stream.packet_source = packet_source
    if receiver_id is not None:
        stream.receiver_id = receiver_id

    _cache_stream_owner(stream_id, logical_vehicle_id)
    if activate:
        _active_stream_by_vehicle[logical_vehicle_id] = (stream_id, time.time())
    return stream


def register_active_run(source_id: str, *, seen_at: float | None = None) -> None:
    """Backward-compatible wrapper for older internal call sites."""
    logical_vehicle_id = run_id_to_source_id(source_id)
    if logical_vehicle_id == source_id:
        return
    existing = _active_stream_by_vehicle.get(logical_vehicle_id)
    if existing is not None:
        existing_stream_id, _ = existing
        existing_started_at = _run_id_started_at(existing_stream_id)
        new_started_at = _run_id_started_at(source_id)
        if (
            existing_started_at is not None
            and new_started_at is not None
            and new_started_at < existing_started_at
        ):
            return
    _active_stream_by_vehicle[logical_vehicle_id] = (source_id, seen_at if seen_at is not None else time.time())


def clear_active_run(source_id: str, *, db: Session | None = None) -> None:
    """Backward-compatible wrapper clearing the active stream for a vehicle."""
    clear_active_stream(run_id_to_source_id(source_id), db=db)


def clear_active_stream(vehicle_id: str, *, db: Session | None = None) -> None:
    """Forget the active stream for a vehicle and mark it idle when possible."""
    logical_vehicle_id = normalize_vehicle_id(vehicle_id)
    _active_stream_by_vehicle.pop(logical_vehicle_id, None)
    _simulator_status_by_vehicle.pop(logical_vehicle_id, None)
    if db is None:
        return
    streams = (
        db.execute(
            select(TelemetryStream).where(
                TelemetryStream.vehicle_id == logical_vehicle_id,
                TelemetryStream.status == "active",
            )
        )
        .scalars()
        .all()
    )
    for stream in streams:
        stream.status = "idle"


def _resolve_simulator_status(
    db: Session,
    logical_vehicle_id: str,
    payload: dict[str, object],
    *,
    refresh_cache: bool,
) -> str | None:
    state = payload.get("state")
    config = payload.get("config") or {}
    if not isinstance(config, dict):
        return None

    active_stream_id = config.get("stream_id")
    packet_source = config.get("packet_source")
    receiver_id = config.get("receiver_id")

    if refresh_cache:
        _cache_simulator_status(
            logical_vehicle_id,
            state=state if isinstance(state, str) else "idle",
            active_stream_id=active_stream_id if isinstance(active_stream_id, str) else None,
            packet_source=packet_source if isinstance(packet_source, str) else None,
            receiver_id=receiver_id if isinstance(receiver_id, str) else None,
        )

    if state == "idle":
        clear_active_stream(logical_vehicle_id, db=db)
        return logical_vehicle_id

    if state and state != "idle" and isinstance(active_stream_id, str) and active_stream_id:
        # Always refresh stream metadata from simulator runtime, even when the stream id is unchanged.
        try:
            register_stream(
                db,
                vehicle_id=logical_vehicle_id,
                stream_id=active_stream_id,
                packet_source=packet_source if isinstance(packet_source, str) else None,
                receiver_id=receiver_id if isinstance(receiver_id, str) else None,
            )
        except (SourceNotFoundError, StreamIdConflictError):
            return None
        return active_stream_id

    return None


def get_cached_active_run_id(vehicle_id: str, *, max_age_sec: float = ACTIVE_STREAM_CACHE_TTL_SEC) -> Optional[str]:
    """Backward-compatible wrapper returning the active stream id for a vehicle."""
    cached = _get_cached_active_run_entry(vehicle_id, max_age_sec=max_age_sec)
    if cached is None:
        return None
    return cached[0]


def _get_cached_active_run_entry(
    vehicle_id: str,
    *,
    max_age_sec: float = ACTIVE_STREAM_CACHE_TTL_SEC,
) -> Optional[tuple[str, float]]:
    logical_vehicle_id = run_id_to_source_id(vehicle_id)
    return _get_ttl_cache_entry(
        _active_stream_by_vehicle,
        logical_vehicle_id,
        ttl_sec=max_age_sec,
    )


def _run_id_started_at(source_id: str) -> Optional[datetime]:
    match = RUN_ID_RE.match(source_id)
    if not match:
        return None
    ts = match.group(2)
    if ts.endswith("Z"):
        ts = ts[:-1]
    return datetime.strptime(ts, "%Y-%m-%dT%H-%M-%S").replace(tzinfo=timezone.utc)


def resolve_active_run_id(db: Session, source_id: str, *, timeout: float = 2.0) -> str:
    """Backward-compatible wrapper returning the active stream id for a vehicle."""
    return resolve_active_stream_id(db, source_id, timeout=timeout)


def resolve_latest_stream_id(db: Session, source_id: str, *, timeout: float = 2.0) -> str:
    """Resolve a vehicle to its latest concrete stream, preserving explicit stream ids."""
    if get_stream_vehicle_id(db, source_id) is not None:
        return source_id

    logical_vehicle_id = resolve_logical_vehicle_id(db, source_id)
    resolved = resolve_active_stream_id(db, logical_vehicle_id, timeout=timeout)
    if resolved != logical_vehicle_id:
        return resolved

    latest_stream_id = (
        db.execute(
            select(TelemetryStream.id)
            .where(TelemetryStream.vehicle_id == logical_vehicle_id)
            .order_by(TelemetryStream.last_seen_at.desc(), TelemetryStream.id.desc())
        )
        .scalars()
        .first()
    )
    if isinstance(latest_stream_id, str) and latest_stream_id:
        return latest_stream_id
    return logical_vehicle_id


def _resolve_simulator_backed_active_stream(
    db: Session,
    logical_vehicle_id: str,
    *,
    base_url: str,
    timeout: float,
    cached_stream_entry: tuple[str, float] | None,
) -> str | None:
    """
    Resolve the active stream for a simulator-backed logical vehicle.

    Precedence:
    1. A newer accepted active-stream cache entry beats an older simulator-status snapshot.
    2. If the simulator status cache is stale, poll live /status.
    3. Otherwise use the throttled cached simulator snapshot.
    """
    cached_status_entry = _get_cached_simulator_status_entry(logical_vehicle_id)

    # A recently accepted active stream is newer than a throttled simulator snapshot.
    if (
        cached_stream_entry is not None
        and cached_status_entry is not None
        and cached_stream_entry[1] >= cached_status_entry[1]
    ):
        return cached_stream_entry[0]

    if _should_refresh_simulator_status(logical_vehicle_id):
        payload: dict[str, object] | None = None
        try:
            with httpx.Client(timeout=timeout) as client:
                res = client.get(f"{base_url.rstrip('/')}/status")
            if res.status_code < 400:
                raw_payload = res.json()
                if isinstance(raw_payload, dict):
                    payload = raw_payload
        except Exception:
            payload = None

        if payload is not None:
            resolved = _resolve_simulator_status(
                db,
                logical_vehicle_id,
                payload,
                refresh_cache=True,
            )
            if resolved is not None:
                return resolved

    if cached_status_entry is not None:
        cached_status, _ = cached_status_entry
        resolved = _resolve_simulator_status(
            db,
            logical_vehicle_id,
            cached_status,
            refresh_cache=False,
        )
        if resolved is not None:
            return resolved

    return None


def resolve_active_stream_id(db: Session, vehicle_id: str, *, timeout: float = 2.0) -> str:
    """Resolve a logical vehicle id to the active telemetry stream id when available."""
    logical_vehicle_id = normalize_vehicle_id(vehicle_id)
    cached_stream_entry = _get_cached_active_run_entry(logical_vehicle_id)

    src = get_logical_source(db, logical_vehicle_id)
    if src is not None and src.source_type == "simulator" and src.base_url:
        resolved = _resolve_simulator_backed_active_stream(
            db,
            logical_vehicle_id,
            base_url=src.base_url,
            timeout=timeout,
            cached_stream_entry=cached_stream_entry,
        )
        if resolved is not None:
            return resolved

    if cached_stream_entry is not None:
        return cached_stream_entry[0]

    freshness_cutoff = datetime.now(timezone.utc) - timedelta(seconds=60)
    row = (
        db.execute(
            select(TelemetryStream)
            .where(
                TelemetryStream.vehicle_id == logical_vehicle_id,
                TelemetryStream.status == "active",
                TelemetryStream.last_seen_at >= freshness_cutoff,
            )
            .order_by(TelemetryStream.last_seen_at.desc())
        )
        .scalars()
        .first()
    )
    if isinstance(row, TelemetryStream):
        _active_stream_by_vehicle[logical_vehicle_id] = (row.id, time.time())
        return row.id

    latest_row = (
        db.execute(
            select(TelemetryStream)
            .where(TelemetryStream.vehicle_id == logical_vehicle_id)
            .order_by(TelemetryStream.last_seen_at.desc())
        )
        .scalars()
        .first()
    )
    current_row = (
        db.execute(
            select(TelemetryCurrent)
            .join(TelemetryMetadata, TelemetryMetadata.id == TelemetryCurrent.telemetry_id)
            .where(
                TelemetryMetadata.vehicle_id == logical_vehicle_id,
                TelemetryCurrent.reception_time >= freshness_cutoff,
            )
            .order_by(
                TelemetryCurrent.reception_time.desc(),
                TelemetryCurrent.generation_time.desc(),
            )
        )
        .scalars()
        .first()
    )
    current_stream_id = getattr(current_row, "stream_id", None)
    if isinstance(current_stream_id, str) and current_stream_id:
        try:
            register_stream(
                db,
                vehicle_id=logical_vehicle_id,
                stream_id=current_stream_id,
                packet_source=getattr(current_row, "packet_source", None),
                receiver_id=getattr(current_row, "receiver_id", None),
                seen_at=getattr(current_row, "reception_time", None),
            )
        except (SourceNotFoundError, StreamIdConflictError):
            pass
        else:
            return current_stream_id

    if latest_row is not None:
        latest_status = getattr(latest_row, "status", None)
        latest_seen_at = getattr(latest_row, "last_seen_at", None)
        if (
            latest_status == "active"
            and isinstance(latest_seen_at, datetime)
            and latest_seen_at >= freshness_cutoff
        ):
            _active_stream_by_vehicle[logical_vehicle_id] = (latest_row.id, time.time())
            return latest_row.id
        if latest_status == "idle":
            return logical_vehicle_id

    return logical_vehicle_id
