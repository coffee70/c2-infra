"""Telemetry database models."""

import uuid
from datetime import datetime
from typing import Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Index, Numeric, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TelemetryMetadata(Base):
    """Telemetry schema and metadata with semantic embedding."""

    __tablename__ = "telemetry_metadata"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(Text, unique=True, index=True, nullable=False)
    units: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    subsystem_tag: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    red_low: Mapped[Optional[float]] = mapped_column(Numeric(20, 10), nullable=True)
    red_high: Mapped[Optional[float]] = mapped_column(Numeric(20, 10), nullable=True)
    embedding: Mapped[Optional[list]] = mapped_column(Vector(384), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )


class TelemetryData(Base):
    """Time-series telemetry data (TimescaleDB hypertable)."""

    __tablename__ = "telemetry_data"

    telemetry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telemetry_metadata.id", ondelete="CASCADE"),
        primary_key=True,
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        primary_key=True,
    )
    value: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)

    __table_args__ = (
        Index("ix_telemetry_data_telemetry_id_timestamp", "telemetry_id", "timestamp"),
    )


class TelemetryStatistics(Base):
    """Precomputed statistics for each telemetry point."""

    __tablename__ = "telemetry_statistics"

    telemetry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telemetry_metadata.id", ondelete="CASCADE"),
        primary_key=True,
    )
    mean: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)
    std_dev: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)
    min_value: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)
    max_value: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)
    p5: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)
    p50: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)
    p95: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)
    n_samples: Mapped[int] = mapped_column(nullable=False, default=0)
    last_computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )


class WatchlistEntry(Base):
    """Operator watchlist configuration."""

    __tablename__ = "watchlist"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    telemetry_name: Mapped[str] = mapped_column(Text, unique=True, index=True, nullable=False)
    display_order: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )


class TelemetrySource(Base):
    """Registry of telemetry stream sources (vehicles, simulators)."""

    __tablename__ = "telemetry_sources"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )


class TelemetryCurrent(Base):
    """Latest value per channel per source for fast realtime reads."""

    __tablename__ = "telemetry_current"

    source_id: Mapped[str] = mapped_column(Text, primary_key=True)
    telemetry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telemetry_metadata.id", ondelete="CASCADE"),
        primary_key=True,
    )
    generation_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    reception_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    value: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False)  # normal, caution, warning
    state_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    z_score: Mapped[Optional[float]] = mapped_column(Numeric(20, 10), nullable=True)
    quality: Mapped[str] = mapped_column(Text, nullable=False, default="valid")
    sequence: Mapped[Optional[int]] = mapped_column(nullable=True)


class TelemetryAlert(Base):
    """Alert lifecycle: opened, acked, cleared, resolved."""

    __tablename__ = "telemetry_alerts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    source_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    telemetry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telemetry_metadata.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    opened_reception_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    last_update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    severity: Mapped[str] = mapped_column(Text, nullable=False)  # caution, warning
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)  # new, acked, resolved
    current_value_at_open: Mapped[float] = mapped_column(Numeric(20, 10), nullable=False)
    acked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    acked_by: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cleared_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resolution_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resolution_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class TelemetryAlertNote(Base):
    """Notes attached to alerts (resolutions, operator comments)."""

    __tablename__ = "telemetry_alert_notes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    alert_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telemetry_alerts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )
    author: Mapped[str] = mapped_column(Text, nullable=False)
    note_text: Mapped[str] = mapped_column(Text, nullable=False)
    note_type: Mapped[str] = mapped_column(Text, nullable=False)  # resolution, comment
