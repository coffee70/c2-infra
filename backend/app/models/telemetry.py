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
