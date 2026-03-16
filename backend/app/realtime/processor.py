"""Realtime processor: persist measurements, compute state, manage alert lifecycle."""

import logging
import threading
import time
from collections import deque
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import uuid4

from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_session_factory
from app.models.schemas import (
    MeasurementEvent,
    RealtimeChannelUpdate,
    RecentDataPoint,
    TelemetryAlertSchema,
)
from app.models.telemetry import (
    PositionChannelMapping,
    TelemetryAlert,
    TelemetryCurrent,
    TelemetryData,
    TelemetryMetadata,
    TelemetryStatistics,
)
from app.lib.audit import audit_log
from app.realtime.bus import get_realtime_bus
from app.realtime.feed_health import get_feed_health_tracker
from app.services.ops_events_service import write_event as write_ops_event
from app.services.source_run_service import (
    get_cached_active_run_id,
    normalize_source_id,
    register_active_run,
    run_id_to_source_id,
)
from app.services.telemetry_service import _compute_state
from app.utils.coordinates import ecef_to_lla, eci_to_lla
from app.utils.subsystem import infer_subsystem

logger = logging.getLogger(__name__)

DEBOUNCE_CONSECUTIVE = 2
SPARKLINE_POINTS = 30
ORBIT_MAPPINGS_CACHE_TTL_SEC = 30
ORBIT_POSITION_TIMESTAMP_WINDOW_SEC = 2.0

# Type for telemetry update handler
TelemetryUpdateHandler = type("TelemetryUpdateHandler", (), {})


def _parse_time(s: str) -> datetime:
    """Parse RFC3339 string to datetime."""
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _get_orbit_mappings(db: Session) -> dict[str, dict[str, str]]:
    """Return source_id -> frame-aware channel mapping for orbit ingestion."""
    stmt = (
        select(
            PositionChannelMapping.source_id,
            PositionChannelMapping.frame_type,
            PositionChannelMapping.lat_channel_name,
            PositionChannelMapping.lon_channel_name,
            PositionChannelMapping.alt_channel_name,
            PositionChannelMapping.x_channel_name,
            PositionChannelMapping.y_channel_name,
            PositionChannelMapping.z_channel_name,
        )
        .where(PositionChannelMapping.active.is_(True))
    )
    rows = db.execute(stmt).fetchall()
    out: dict[str, dict[str, str]] = {}
    for r in rows:
        frame_type = r[1]
        if frame_type == "gps_lla":
            lat = r[2] or ""
            lon = r[3] or ""
            alt = r[4] or ""
            if lat and lon:
                out[r[0]] = {"frame_type": frame_type, "lat": lat, "lon": lon, "alt": alt}
        elif frame_type in {"ecef", "eci"}:
            x = r[5] or ""
            y = r[6] or ""
            z = r[7] or ""
            if x and y and z:
                out[r[0]] = {"frame_type": frame_type, "x": x, "y": y, "z": z}
    return out


class RealtimeProcessor:
    """Process measurement events: persist, compute state, emit updates and alerts."""

    def __init__(self) -> None:
        self._session_factory = get_session_factory()
        self._state_history: dict[tuple[str, str], deque[str]] = {}
        self._state_history_lock = threading.Lock()
        self._telemetry_update_handlers: list = []
        self._bus = get_realtime_bus()
        self._sparkline_history: dict[tuple[str, str], deque[RecentDataPoint]] = {}
        self._sparkline_history_lock = threading.Lock()
        # Orbit: sources with position mapping -> (lat, lon, alt) channel names
        self._orbit_mappings: dict[str, dict[str, str]] = {}
        self._orbit_mappings_at: float = 0.0
        self._orbit_mappings_lock = threading.Lock()
        self._orbit_active_input_source: dict[str, str] = {}
        # Per-source position buffer for orbit, grouped by generation timestamp.
        self._orbit_position_buffer: dict[str, dict] = {}
        self._orbit_buffer_lock = threading.Lock()

    def _get_state_history(self, source_id: str, channel: str) -> deque[str]:
        """Get or create state history for source+channel (keeps last N). Caller must hold _state_history_lock."""
        key = (source_id, channel)
        if key not in self._state_history:
            self._state_history[key] = deque(maxlen=DEBOUNCE_CONSECUTIVE)
        return self._state_history[key]

    def _append_sparkline_point(
        self,
        source_id: str,
        channel: str,
        point: RecentDataPoint,
    ) -> list[RecentDataPoint]:
        """Maintain a small in-memory sparkline cache for realtime WebSocket updates."""
        key = (source_id, channel)
        with self._sparkline_history_lock:
            history = self._sparkline_history.get(key)
            if history is None:
                history = deque(maxlen=SPARKLINE_POINTS)
                self._sparkline_history[key] = history
            if not history or history[-1].timestamp != point.timestamp or history[-1].value != point.value:
                history.append(point)
            return list(history)

    def _on_measurement(self, event: MeasurementEvent) -> None:
        """Handle a measurement event (runs in thread pool)."""
        session = self._session_factory()
        try:
            self._process_measurement(session, event)
            session.commit()
        except Exception as e:
            session.rollback()
            logger.exception("RealtimeProcessor error for %s: %s", event.channel_name, e)
        finally:
            session.close()

    def _process_measurement(
        self,
        db: Session,
        event: MeasurementEvent,
    ) -> None:
        """Process single measurement: validate, persist, update current, check alerts."""
        source_id = normalize_source_id(event.source_id or "default")
        register_active_run(source_id)
        get_feed_health_tracker().record_reception(source_id)
        logical_source_id = run_id_to_source_id(source_id)

        meta = db.execute(
            select(TelemetryMetadata).where(
                TelemetryMetadata.source_id == logical_source_id,
                TelemetryMetadata.name == event.channel_name,
            )
        ).scalars().first()
        if not meta:
            logger.debug("Unknown channel %s, skipping", event.channel_name)
            return

        gen_time = _parse_time(event.generation_time)
        recv_time = (
            _parse_time(event.reception_time)
            if event.reception_time
            else datetime.now(timezone.utc)
        )

        # Persist to Timescale
        try:
            db.add(
                TelemetryData(
                    source_id=source_id,
                    telemetry_id=meta.id,
                    timestamp=gen_time,
                    value=Decimal(str(event.value)),
                )
            )
            db.flush()
        except IntegrityError as e:
            logger.debug("Insert skipped for %s (e.g. duplicate): %s", event.channel_name, e)
            db.rollback()
            # Session starts new transaction; continue to update current

        # Out-of-order: only update current if generation_time is newer
        current = db.get(TelemetryCurrent, (source_id, meta.id))
        if current and gen_time <= current.generation_time:
            return

        # Compute state
        stats = db.get(TelemetryStatistics, (source_id, meta.id))
        std_dev = float(stats.std_dev) if stats else 0.0
        mean = float(stats.mean) if stats else 0.0
        red_low = float(meta.red_low) if meta.red_low is not None else None
        red_high = float(meta.red_high) if meta.red_high is not None else None
        z_score = (
            (event.value - mean) / std_dev
            if std_dev > 0 and stats
            else None
        )

        if not stats:
            state, reason = "normal", None
        else:
            state, reason = _compute_state(
                event.value, z_score, red_low, red_high, std_dev
            )

        # Debounce: update history (lock guards dict and deque for thread-pool concurrency)
        with self._state_history_lock:
            history = self._get_state_history(source_id, event.channel_name)
            history.append(state)
            should_open_alert = list(history) == ["warning"] * DEBOUNCE_CONSECUTIVE
            should_clear_alert = list(history) == ["normal"] * DEBOUNCE_CONSECUTIVE

        # Upsert telemetry_current
        if current:
            current.generation_time = gen_time
            current.reception_time = recv_time
            current.value = Decimal(str(event.value))
            current.state = state
            current.state_reason = reason
            current.z_score = Decimal(str(z_score)) if z_score is not None else None
            current.quality = event.quality
            current.sequence = event.sequence
        else:
            db.add(
                TelemetryCurrent(
                    source_id=source_id,
                    telemetry_id=meta.id,
                    generation_time=gen_time,
                    reception_time=recv_time,
                    value=Decimal(str(event.value)),
                    state=state,
                    state_reason=reason,
                    z_score=Decimal(str(z_score)) if z_score is not None else None,
                    quality=event.quality,
                    sequence=event.sequence,
                )
            )

        sparkline_data = self._append_sparkline_point(
            source_id,
            meta.name,
            RecentDataPoint(timestamp=gen_time.isoformat(), value=event.value),
        )

        subsystem = infer_subsystem(event.channel_name, meta)

        # Build update for UI
        update = RealtimeChannelUpdate(
            source_id=source_id,
            name=meta.name,
            units=meta.units,
            description=meta.description,
            subsystem_tag=subsystem,
            current_value=event.value,
            generation_time=gen_time.isoformat(),
            reception_time=recv_time.isoformat(),
            state=state,
            state_reason=reason,
            z_score=z_score,
            quality=event.quality,
            sparkline_data=sparkline_data,
        )

        # Alert lifecycle: open after 2 consecutive warnings
        if should_open_alert:
            open_alert = db.execute(
                select(TelemetryAlert)
                .where(TelemetryAlert.source_id == source_id)
                .where(TelemetryAlert.telemetry_id == meta.id)
                .where(TelemetryAlert.cleared_at.is_(None))
                .where(TelemetryAlert.resolved_at.is_(None))
                .order_by(desc(TelemetryAlert.opened_at))
                .limit(1)
            ).scalars().first()
            if not open_alert:
                alert = TelemetryAlert(
                    id=uuid4(),
                    source_id=source_id,
                    telemetry_id=meta.id,
                    opened_at=gen_time,
                    opened_reception_at=recv_time,
                    last_update_at=recv_time,
                    severity="warning",
                    reason=reason,
                    status="new",
                    current_value_at_open=Decimal(str(event.value)),
                )
                db.add(alert)
                db.flush()
                audit_log(
                    "alert.opened",
                    alert_id=str(alert.id),
                    channel_name=meta.name,
                    source_id=source_id,
                    reason=reason,
                    z_score=z_score,
                )
                logger.info("Alert opened: channel=%s severity=%s", meta.name, "warning")
                write_ops_event(
                    db,
                    source_id=source_id,
                    event_time=gen_time,
                    event_type="alert.opened",
                    severity="warning",
                    summary=f"{meta.name} out of family/limits",
                    entity_type="alert",
                    entity_id=meta.name,
                    payload={
                        "alert_id": str(alert.id),
                        "channel_name": meta.name,
                        "value": event.value,
                        "reason": reason,
                        "z_score": z_score,
                    },
                )
                self._publish_alert_event(
                    "opened",
                    alert,
                    meta,
                    event.value,
                    reason,
                    z_score,
                    red_low,
                    red_high,
                    subsystem,
                )

        # Alert lifecycle: clear after 2 consecutive normals
        if should_clear_alert:
            open_alert = db.execute(
                select(TelemetryAlert)
                .where(TelemetryAlert.source_id == source_id)
                .where(TelemetryAlert.telemetry_id == meta.id)
                .where(TelemetryAlert.cleared_at.is_(None))
                .where(TelemetryAlert.resolved_at.is_(None))
                .order_by(desc(TelemetryAlert.opened_at))
                .limit(1)
            ).scalars().first()
            if open_alert:
                open_alert.cleared_at = recv_time
                open_alert.last_update_at = recv_time
                audit_log(
                    "alert.cleared",
                    alert_id=str(open_alert.id),
                    channel_name=meta.name,
                    source_id=source_id,
                )
                logger.info("Alert cleared: channel=%s", meta.name)
                write_ops_event(
                    db,
                    source_id=source_id,
                    event_time=recv_time,
                    event_type="alert.cleared",
                    severity="info",
                    summary=f"{meta.name} returned to normal",
                    entity_type="alert",
                    entity_id=meta.name,
                    payload={
                        "alert_id": str(open_alert.id),
                        "channel_name": meta.name,
                        "value": event.value,
                    },
                )
                self._publish_alert_event(
                    "cleared",
                    open_alert,
                    meta,
                    event.value,
                    None,
                    z_score,
                    red_low,
                    red_high,
                    subsystem,
                )

        # Broadcast telemetry update
        self._broadcast_telemetry_update(update)

        # Orbit: if this source has a position mapping and channel is lat/lon/alt, buffer and maybe push
        self._maybe_submit_orbit_sample(db, source_id, event.channel_name, event.value, gen_time)

    def _publish_alert_event(
        self,
        event_type: str,
        alert: TelemetryAlert,
        meta: TelemetryMetadata,
        current_value: float,
        reason: Optional[str],
        z_score: Optional[float],
        red_low: Optional[float],
        red_high: Optional[float],
        subsystem: str,
    ) -> None:
        """Publish alert event to bus."""
        schema = TelemetryAlertSchema(
            id=str(alert.id),
            source_id=alert.source_id,
            channel_name=meta.name,
            telemetry_id=str(meta.id),
            subsystem=subsystem,
            units=meta.units,
            severity=alert.severity,
            reason=reason,
            status=alert.status,
            opened_at=alert.opened_at.isoformat(),
            opened_reception_at=alert.opened_reception_at.isoformat(),
            last_update_at=alert.last_update_at.isoformat(),
            current_value=current_value,
            red_low=red_low,
            red_high=red_high,
            z_score=z_score,
            acked_at=alert.acked_at.isoformat() if alert.acked_at else None,
            acked_by=alert.acked_by,
            cleared_at=alert.cleared_at.isoformat() if alert.cleared_at else None,
            resolved_at=alert.resolved_at.isoformat() if alert.resolved_at else None,
            resolved_by=alert.resolved_by,
            resolution_text=alert.resolution_text,
            resolution_code=alert.resolution_code,
        )
        self._bus.publish_alert({"type": event_type, "alert": schema.model_dump()})

    def _maybe_submit_orbit_sample(
        self,
        db: Session,
        source_id: str,
        channel_name: str,
        value: float,
        gen_time: datetime,
    ) -> None:
        """If source has position mapping and this is a position channel, buffer and maybe push to orbit."""
        now = time.time()
        with self._orbit_mappings_lock:
            if now - self._orbit_mappings_at > ORBIT_MAPPINGS_CACHE_TTL_SEC:
                self._orbit_mappings = _get_orbit_mappings(db)
                self._orbit_mappings_at = now
            mappings = self._orbit_mappings
        logical_source_id = run_id_to_source_id(source_id)
        cached_run_id = get_cached_active_run_id(logical_source_id)
        if cached_run_id is not None and cached_run_id != source_id:
            return
        if logical_source_id not in mappings:
            return
        mapping = mappings[logical_source_id]
        frame_type = mapping["frame_type"]
        should_reset_source = False
        with self._orbit_buffer_lock:
            active_input_source = self._orbit_active_input_source.get(logical_source_id)
            if active_input_source is not None and active_input_source != source_id:
                should_reset_source = True
                self._orbit_position_buffer.pop(logical_source_id, None)
            self._orbit_active_input_source[logical_source_id] = source_id
        if should_reset_source:
            from app.orbit import reset_source as reset_orbit_source

            reset_orbit_source(logical_source_id)
        slot: Optional[str] = None
        if frame_type == "gps_lla":
            lat_name = mapping["lat"]
            lon_name = mapping["lon"]
            alt_name = mapping.get("alt", "")
            if channel_name == lat_name:
                slot = "lat"
            elif channel_name == lon_name:
                slot = "lon"
            elif channel_name == alt_name:
                slot = "alt"
        elif frame_type in {"ecef", "eci"}:
            if channel_name == mapping["x"]:
                slot = "x"
            elif channel_name == mapping["y"]:
                slot = "y"
            elif channel_name == mapping["z"]:
                slot = "z"
        if slot is None:
            return
        ts_unix = gen_time.timestamp()
        with self._orbit_buffer_lock:
            if logical_source_id not in self._orbit_position_buffer:
                self._orbit_position_buffer[logical_source_id] = {
                    "samples": {},
                    "last_pushed_ts": 0.0,
                }
            buf = self._orbit_position_buffer[logical_source_id]
            last_pushed = buf["last_pushed_ts"]
            if ts_unix <= last_pushed:
                return
            samples_by_ts = buf["samples"]
            for sample_ts in list(samples_by_ts.keys()):
                if sample_ts <= last_pushed or ts_unix - sample_ts > ORBIT_POSITION_TIMESTAMP_WINDOW_SEC:
                    samples_by_ts.pop(sample_ts, None)
            sample = samples_by_ts.setdefault(ts_unix, {})
            sample[slot] = value
            if frame_type == "gps_lla":
                lat = sample.get("lat")
                lon = sample.get("lon")
                alt = sample.get("alt")
                alt_ready = mapping.get("alt", "") == "" or alt is not None
                if lat is None or lon is None or not alt_ready:
                    return
                alt_val = alt if alt is not None else 0.0
            else:
                x = sample.get("x")
                y = sample.get("y")
                z = sample.get("z")
                if x is None or y is None or z is None:
                    return
                if frame_type == "ecef":
                    lat, lon, alt_val = ecef_to_lla(float(x), float(y), float(z))
                else:
                    lat, lon, alt_val = eci_to_lla(float(x), float(y), float(z), gen_time)
        try:
            from app.orbit import submit_position_sample

            submit_position_sample(logical_source_id, ts_unix, lat, lon, alt_val)
            with self._orbit_buffer_lock:
                if logical_source_id in self._orbit_position_buffer:
                    buf = self._orbit_position_buffer[logical_source_id]
                    buf["last_pushed_ts"] = ts_unix
                    buf["samples"].pop(ts_unix, None)
        except Exception as e:
            logger.exception("Orbit submit_position_sample error for %s: %s", logical_source_id, e)

    def _broadcast_telemetry_update(self, update: RealtimeChannelUpdate) -> None:
        """Broadcast to registered handlers (e.g. WebSocket hub)."""
        for h in self._telemetry_update_handlers:
            try:
                h(update)
            except Exception as e:
                logger.exception("Telemetry update handler error: %s", e)

    def register_telemetry_update_handler(self, handler) -> None:
        """Register handler for telemetry updates (called by WebSocket hub)."""
        self._telemetry_update_handlers.append(handler)

    def unregister_telemetry_update_handler(self, handler) -> None:
        """Unregister handler."""
        if handler in self._telemetry_update_handlers:
            self._telemetry_update_handlers.remove(handler)

    def start(self) -> None:
        """Register with bus and start processing."""
        self._bus.subscribe_measurements(self._on_measurement)
        logger.info("RealtimeProcessor started")

    def stop(self) -> None:
        """Unregister from bus."""
        self._bus.unsubscribe_measurements(self._on_measurement)
        logger.info("RealtimeProcessor stopped")
