"""Resolve logical telemetry sources to their active run ids."""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.models.telemetry import TelemetrySource

RUN_ID_RE = re.compile(r"^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?)$")
ACTIVE_RUN_CACHE_TTL_SEC = 30.0
_active_run_by_source: dict[str, tuple[str, float]] = {}


def run_id_to_source_id(source_id: str) -> str:
    """Collapse a run id back to its logical source id."""
    match = RUN_ID_RE.match(source_id)
    if not match:
        return source_id
    prefix = match.group(1)
    if prefix.startswith("simulator-"):
        return "simulator"
    return prefix


def _run_id_started_at(source_id: str) -> Optional[datetime]:
    match = RUN_ID_RE.match(source_id)
    if not match:
        return None
    ts = match.group(2)
    if ts.endswith("Z"):
        ts = ts[:-1]
    return datetime.strptime(ts, "%Y-%m-%dT%H-%M-%S").replace(tzinfo=timezone.utc)


def get_logical_source(db: Session, source_id: str) -> Optional[TelemetrySource]:
    """Return the logical source row for either a source id or a run id."""
    direct = db.get(TelemetrySource, source_id)
    if direct is not None:
        return direct
    return db.get(TelemetrySource, run_id_to_source_id(source_id))


def register_active_run(source_id: str, *, seen_at: float | None = None) -> None:
    """Remember the most recent run id observed for a logical source."""
    logical_source_id = run_id_to_source_id(source_id)
    if logical_source_id == source_id:
        return
    existing = _active_run_by_source.get(logical_source_id)
    if existing is not None:
        existing_run_id, _ = existing
        existing_started_at = _run_id_started_at(existing_run_id)
        new_started_at = _run_id_started_at(source_id)
        if (
            existing_started_at is not None
            and new_started_at is not None
            and new_started_at < existing_started_at
        ):
            return
    _active_run_by_source[logical_source_id] = (
        source_id,
        seen_at if seen_at is not None else time.time(),
    )


def clear_active_run(source_id: str) -> None:
    """Forget the active run for a logical source."""
    _active_run_by_source.pop(run_id_to_source_id(source_id), None)


def get_cached_active_run_id(source_id: str, *, max_age_sec: float = ACTIVE_RUN_CACHE_TTL_SEC) -> Optional[str]:
    """Return the most recent run id seen for the logical source, if still fresh."""
    logical_source_id = run_id_to_source_id(source_id)
    cached = _active_run_by_source.get(logical_source_id)
    if cached is None:
        return None
    run_id, seen_at = cached
    if time.time() - seen_at > max_age_sec:
        _active_run_by_source.pop(logical_source_id, None)
        return None
    return run_id


def resolve_active_run_id(db: Session, source_id: str, *, timeout: float = 2.0) -> str:
    """Resolve a logical source id to the active run id when available."""
    src = get_logical_source(db, source_id)
    if src is None or src.source_type != "simulator" or not src.base_url:
        return source_id

    cached_run_id = get_cached_active_run_id(source_id)
    if cached_run_id is not None:
        return cached_run_id

    try:
        with httpx.Client(timeout=timeout) as client:
            res = client.get(f"{src.base_url.rstrip('/')}/status")
        if res.status_code >= 400:
            return source_id
        payload = res.json()
    except Exception:
        return source_id

    state = payload.get("state")
    config = payload.get("config") or {}
    active_run_id = config.get("source_id")
    if state and state != "idle" and isinstance(active_run_id, str) and active_run_id:
        register_active_run(active_run_id)
        return active_run_id
    if state == "idle":
        clear_active_run(source_id)
    return source_id
