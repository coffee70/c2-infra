"""Realtime snapshot and subscription helpers."""

import logging
from datetime import datetime

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models.schemas import RealtimeChannelUpdate, RecentDataPoint, TelemetryAlertSchema
from app.models.telemetry import (
    TelemetryAlert,
    TelemetryCurrent,
    TelemetryData,
    TelemetryMetadata,
    TelemetrySource,
    WatchlistEntry,
)
from app.utils.subsystem import infer_subsystem

logger = logging.getLogger(__name__)

SPARKLINE_POINTS = 30


def get_realtime_snapshot_for_channels(
    db: Session,
    channel_names: list[str],
    source_id: str = "default",
) -> list[RealtimeChannelUpdate]:
    """Get current values from telemetry_current for given channels and source."""
    if not channel_names:
        return []

    stmt = (
        select(TelemetryMetadata, TelemetryCurrent)
        .join(TelemetryCurrent, TelemetryMetadata.id == TelemetryCurrent.telemetry_id)
        .where(TelemetryCurrent.source_id == source_id)
        .where(TelemetryMetadata.name.in_(channel_names))
    )
    rows = db.execute(stmt).fetchall()
    result = []

    for meta, curr in rows:
        # Sparkline from telemetry_data
        spark_stmt = (
            select(TelemetryData.timestamp, TelemetryData.value)
            .where(TelemetryData.telemetry_id == meta.id)
            .order_by(desc(TelemetryData.timestamp))
            .limit(SPARKLINE_POINTS)
        )
        spark_rows = db.execute(spark_stmt).fetchall()
        sparkline_data = [
            RecentDataPoint(timestamp=r[0].isoformat(), value=float(r[1]))
            for r in reversed(spark_rows)
        ]

        result.append(
            RealtimeChannelUpdate(
                source_id=source_id,
                name=meta.name,
                units=meta.units,
                description=meta.description,
                subsystem_tag=infer_subsystem(meta.name, meta),
                current_value=float(curr.value),
                generation_time=curr.generation_time.isoformat(),
                reception_time=curr.reception_time.isoformat(),
                state=curr.state,
                state_reason=curr.state_reason,
                z_score=float(curr.z_score) if curr.z_score is not None else None,
                quality=curr.quality,
                sparkline_data=sparkline_data,
            )
        )
    return result


def get_watchlist_channel_names(db: Session) -> list[str]:
    """Get watchlist channel names in display order."""
    stmt = (
        select(WatchlistEntry.telemetry_name)
        .order_by(WatchlistEntry.display_order)
    )
    return [r[0] for r in db.execute(stmt).fetchall()]


def get_active_alerts(
    db: Session,
    source_id: str = "default",
    subsystems: list[str] | None = None,
    severities: list[str] | None = None,
) -> list[TelemetryAlertSchema]:
    """Get active (non-resolved, non-cleared) alerts for a source."""
    stmt = (
        select(TelemetryAlert, TelemetryMetadata)
        .join(TelemetryMetadata, TelemetryAlert.telemetry_id == TelemetryMetadata.id)
        .where(TelemetryAlert.source_id == source_id)
        .where(TelemetryAlert.cleared_at.is_(None))
        .where(TelemetryAlert.resolved_at.is_(None))
        .order_by(desc(TelemetryAlert.opened_at))
    )
    rows = db.execute(stmt).fetchall()
    result = []

    for alert, meta in rows:
        subsys = infer_subsystem(meta.name, meta)
        if subsystems and subsys not in subsystems:
            continue
        if severities and alert.severity not in severities:
            continue

        result.append(
            TelemetryAlertSchema(
                id=str(alert.id),
                source_id=alert.source_id,
                channel_name=meta.name,
                telemetry_id=str(meta.id),
                subsystem=subsys,
                units=meta.units,
                severity=alert.severity,
                reason=alert.reason,
                status=alert.status,
                opened_at=alert.opened_at.isoformat(),
                opened_reception_at=alert.opened_reception_at.isoformat(),
                last_update_at=alert.last_update_at.isoformat(),
                current_value=float(alert.current_value_at_open),
                red_low=float(meta.red_low) if meta.red_low else None,
                red_high=float(meta.red_high) if meta.red_high else None,
                z_score=None,
                acked_at=alert.acked_at.isoformat() if alert.acked_at else None,
                acked_by=alert.acked_by,
                cleared_at=None,
                resolved_at=None,
                resolved_by=None,
                resolution_text=None,
                resolution_code=None,
            )
        )
    return result


def get_telemetry_sources(db: Session) -> list[dict]:
    """Get list of registered telemetry sources."""
    stmt = select(TelemetrySource).order_by(TelemetrySource.id)
    rows = db.execute(stmt).scalars().all()
    return [
        {"id": r.id, "name": r.name, "description": r.description}
        for r in rows
    ]
