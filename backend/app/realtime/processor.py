"""Realtime processor: persist measurements, compute state, manage alert lifecycle."""

import logging
import threading
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
from app.services.telemetry_service import _compute_state
from app.utils.subsystem import infer_subsystem

logger = logging.getLogger(__name__)

DEBOUNCE_CONSECUTIVE = 2
SPARKLINE_POINTS = 30

# Type for telemetry update handler
TelemetryUpdateHandler = type("TelemetryUpdateHandler", (), {})


def _parse_time(s: str) -> datetime:
    """Parse RFC3339 string to datetime."""
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class RealtimeProcessor:
    """Process measurement events: persist, compute state, emit updates and alerts."""

    def __init__(self) -> None:
        self._session_factory = get_session_factory()
        self._state_history: dict[tuple[str, str], deque[str]] = {}
        self._state_history_lock = threading.Lock()
        self._telemetry_update_handlers: list = []
        self._bus = get_realtime_bus()

    def _get_state_history(self, source_id: str, channel: str) -> deque[str]:
        """Get or create state history for source+channel (keeps last N). Caller must hold _state_history_lock."""
        key = (source_id, channel)
        if key not in self._state_history:
            self._state_history[key] = deque(maxlen=DEBOUNCE_CONSECUTIVE)
        return self._state_history[key]

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
        source_id = event.source_id or "default"
        get_feed_health_tracker().record_reception(source_id)

        meta = db.execute(
            select(TelemetryMetadata).where(TelemetryMetadata.name == event.channel_name)
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

        # Sparkline data
        spark_stmt = (
            select(TelemetryData.timestamp, TelemetryData.value)
            .where(
                TelemetryData.telemetry_id == meta.id,
                TelemetryData.source_id == source_id,
            )
            .order_by(desc(TelemetryData.timestamp))
            .limit(SPARKLINE_POINTS)
        )
        spark_rows = db.execute(spark_stmt).fetchall()
        sparkline_data = [
            RecentDataPoint(timestamp=r[0].isoformat(), value=float(r[1]))
            for r in reversed(spark_rows)
        ]

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
