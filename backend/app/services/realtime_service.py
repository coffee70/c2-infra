"""Realtime snapshot and subscription helpers."""

import logging
import uuid
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
        {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "source_type": r.source_type,
            "base_url": r.base_url,
        }
        for r in rows
    ]


def create_source(
    db: Session,
    source_type: str,
    name: str,
    *,
    description: str | None = None,
    base_url: str | None = None,
) -> dict:
    """Create a new telemetry source. Returns the created source dict."""
    if source_type not in ("vehicle", "simulator"):
        raise ValueError("source_type must be 'vehicle' or 'simulator'")
    if source_type == "simulator" and not base_url:
        raise ValueError("base_url is required for simulator sources")
    prefix = "sim_" if source_type == "simulator" else "veh_"
    source_id = f"{prefix}{uuid.uuid4().hex[:8]}"
    src = TelemetrySource(
        id=source_id,
        name=name,
        description=description,
        source_type=source_type,
        base_url=base_url if source_type == "simulator" else None,
    )
    db.add(src)
    db.commit()
    db.refresh(src)
    return {
        "id": src.id,
        "name": src.name,
        "description": src.description,
        "source_type": src.source_type,
        "base_url": src.base_url,
    }


def update_source(
    db: Session,
    source_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    base_url: str | None = None,
) -> dict | None:
    """Update a telemetry source. Returns updated source dict or None if not found."""
    src = db.get(TelemetrySource, source_id)
    if not src:
        return None
    if name is not None:
        src.name = name
    if description is not None:
        src.description = description
    if base_url is not None and src.source_type == "simulator":
        src.base_url = base_url
    db.commit()
    db.refresh(src)
    return {
        "id": src.id,
        "name": src.name,
        "description": src.description,
        "source_type": src.source_type,
        "base_url": src.base_url,
    }


def get_source_by_id(db: Session, source_id: str) -> dict | None:
    """Get a single source by id."""
    src = db.get(TelemetrySource, source_id)
    if not src:
        return None
    return {
        "id": src.id,
        "name": src.name,
        "description": src.description,
        "source_type": src.source_type,
        "base_url": src.base_url,
    }
