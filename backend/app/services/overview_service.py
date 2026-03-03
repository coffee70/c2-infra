"""Overview dashboard and watchlist service."""

import logging
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models.telemetry import (
    TelemetryCurrent,
    TelemetryData,
    TelemetryMetadata,
    TelemetryStatistics,
    WatchlistEntry,
)
from app.services.telemetry_service import _compute_state
from app.utils.subsystem import infer_subsystem

logger = logging.getLogger(__name__)

SPARKLINE_POINTS = 30


def get_all_telemetry_names(db: Session) -> list[str]:
    """Get all telemetry names for watchlist config."""
    stmt = select(TelemetryMetadata.name).order_by(TelemetryMetadata.name)
    return [r[0] for r in db.execute(stmt).fetchall()]


def get_watchlist(db: Session) -> list[dict]:
    """Get watchlist entries ordered by display_order."""
    stmt = (
        select(WatchlistEntry.telemetry_name, WatchlistEntry.display_order)
        .order_by(WatchlistEntry.display_order)
    )
    rows = db.execute(stmt).fetchall()
    return [{"name": r[0], "display_order": r[1]} for r in rows]


def add_to_watchlist(db: Session, telemetry_name: str) -> None:
    """Add a channel to the watchlist."""
    # Verify telemetry exists
    meta = db.execute(
        select(TelemetryMetadata).where(TelemetryMetadata.name == telemetry_name)
    ).scalar_one_or_none()
    if not meta:
        raise ValueError(f"Telemetry not found: {telemetry_name}")

    existing = db.execute(
        select(WatchlistEntry).where(WatchlistEntry.telemetry_name == telemetry_name)
    ).scalar_one_or_none()
    if existing:
        return  # Already in watchlist

    max_result = db.execute(
        select(func.max(WatchlistEntry.display_order))
    ).scalar()
    next_order = (max_result or -1) + 1

    entry = WatchlistEntry(telemetry_name=telemetry_name, display_order=next_order)
    db.add(entry)


def remove_from_watchlist(db: Session, telemetry_name: str) -> None:
    """Remove a channel from the watchlist."""
    entry = db.execute(
        select(WatchlistEntry).where(WatchlistEntry.telemetry_name == telemetry_name)
    ).scalar_one_or_none()
    if entry:
        db.delete(entry)


def _get_latest_value_and_ts(db: Session, telemetry_id) -> Optional[tuple[float, datetime]]:
    """Get latest value and timestamp for a telemetry point."""
    stmt = (
        select(TelemetryData.timestamp, TelemetryData.value)
        .where(TelemetryData.telemetry_id == telemetry_id)
        .order_by(desc(TelemetryData.timestamp))
        .limit(1)
    )
    row = db.execute(stmt).fetchone()
    if row:
        return (float(row[1]), row[0])
    return None


def _get_recent_for_sparkline(db: Session, telemetry_id, limit: int = SPARKLINE_POINTS) -> list[dict]:
    """Get recent data points for sparkline (oldest first for chart)."""
    stmt = (
        select(TelemetryData.timestamp, TelemetryData.value)
        .where(TelemetryData.telemetry_id == telemetry_id)
        .order_by(desc(TelemetryData.timestamp))
        .limit(limit)
    )
    rows = db.execute(stmt).fetchall()
    # Reverse so oldest first for chart
    return [
        {"timestamp": r[0].isoformat(), "value": float(r[1])}
        for r in reversed(rows)
    ]


def get_overview(db: Session, source_id: str = "default") -> list[dict]:
    """Get overview data for all watchlist channels, optionally filtered by source."""
    watchlist = get_watchlist(db)
    if not watchlist:
        return []

    result = []
    for entry in watchlist:
        name = entry["name"]
        meta = db.execute(
            select(TelemetryMetadata).where(TelemetryMetadata.name == name)
        ).scalars().first()
        if not meta:
            continue

        stats = db.get(TelemetryStatistics, meta.id)
        if not stats:
            continue

        # Prefer TelemetryCurrent for the source; fall back to TelemetryData
        current = db.get(TelemetryCurrent, (source_id, meta.id))
        if current:
            value, ts = float(current.value), current.generation_time
        else:
            latest = _get_latest_value_and_ts(db, meta.id)
            if not latest:
                continue
            value, ts = latest
        std_dev = float(stats.std_dev)
        mean = float(stats.mean)
        z_score = (value - mean) / std_dev if std_dev > 0 else None
        red_low = float(meta.red_low) if meta.red_low is not None else None
        red_high = float(meta.red_high) if meta.red_high is not None else None
        state, state_reason = _compute_state(value, z_score, red_low, red_high, std_dev)

        sparkline_data = _get_recent_for_sparkline(db, meta.id)

        result.append({
            "name": meta.name,
            "units": meta.units,
            "description": meta.description,
            "subsystem_tag": infer_subsystem(name, meta),
            "current_value": value,
            "last_timestamp": ts.isoformat(),
            "state": state,
            "state_reason": state_reason,
            "z_score": z_score,
            "sparkline_data": sparkline_data,
        })

    return result


def get_anomalies(db: Session, source_id: str = "default") -> dict[str, list[dict]]:
    """Get anomalous channels grouped by subsystem, optionally filtered by source."""
    stmt = select(TelemetryMetadata, TelemetryStatistics).join(
        TelemetryStatistics,
        TelemetryMetadata.id == TelemetryStatistics.telemetry_id,
    )
    rows = db.execute(stmt).fetchall()

    anomalies_by_subsystem: dict[str, list[dict]] = defaultdict(list)

    for meta, stats in rows:
        current = db.get(TelemetryCurrent, (source_id, meta.id))
        if current:
            value, ts = float(current.value), current.generation_time
        else:
            latest = _get_latest_value_and_ts(db, meta.id)
            if not latest:
                continue
            value, ts = latest
        std_dev = float(stats.std_dev)
        mean = float(stats.mean)
        z_score = (value - mean) / std_dev if std_dev > 0 else None
        red_low = float(meta.red_low) if meta.red_low is not None else None
        red_high = float(meta.red_high) if meta.red_high is not None else None
        state, state_reason = _compute_state(value, z_score, red_low, red_high, std_dev)

        if state != "warning":
            continue

        subsystem = infer_subsystem(meta.name, meta)
        anomalies_by_subsystem[subsystem].append({
            "name": meta.name,
            "units": meta.units,
            "current_value": value,
            "last_timestamp": ts.isoformat(),
            "z_score": z_score,
            "state_reason": state_reason,
        })

    # Sort each group by last_timestamp descending
    for subsystem in anomalies_by_subsystem:
        anomalies_by_subsystem[subsystem].sort(
            key=lambda x: x["last_timestamp"],
            reverse=True,
        )

    # Normalize to expected subsystem keys; put unknown in "other"
    known = {"power", "thermal", "adcs", "comms"}
    result = {k: anomalies_by_subsystem.get(k, []) for k in known}
    other = []
    for k, v in anomalies_by_subsystem.items():
        if k not in known:
            other.extend(v)
    other.sort(key=lambda x: x["last_timestamp"], reverse=True)
    result["other"] = other
    return result
