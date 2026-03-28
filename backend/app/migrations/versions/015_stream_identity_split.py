"""Add telemetry stream registry and packet identity columns.

Revision ID: 015
Revises: 014
Create Date: 2026-03-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.services.source_run_service import run_id_to_source_id

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _split_ops_event_source_id(legacy_source_id: str) -> tuple[str, str | None]:
    logical_vehicle_id = run_id_to_source_id(legacy_source_id)
    if logical_vehicle_id == legacy_source_id:
        return legacy_source_id, None
    return logical_vehicle_id, legacy_source_id


def _collect_telemetry_stream_rows(current_rows, data_rows):
    rows_by_stream = {}

    def record_row(source_id, vehicle_id, observed_at, packet_source, receiver_id):
        if observed_at is None:
            return
        existing = rows_by_stream.get(source_id)
        if existing is None:
            rows_by_stream[source_id] = {
                "id": source_id,
                "vehicle_id": vehicle_id,
                "packet_source": packet_source,
                "receiver_id": receiver_id,
                "status": "active",
                "started_at": observed_at,
                "last_seen_at": observed_at,
                "metadata": None,
            }
            return

        if observed_at < existing["started_at"]:
            existing["started_at"] = observed_at
        if observed_at > existing["last_seen_at"]:
            existing["last_seen_at"] = observed_at
            existing["packet_source"] = packet_source
            existing["receiver_id"] = receiver_id

    for row in current_rows:
        record_row(row.source_id, row.vehicle_id, row.observed_at, row.packet_source, row.receiver_id)

    for row in data_rows:
        record_row(row.source_id, row.vehicle_id, row.observed_at, row.packet_source, row.receiver_id)

    return list(rows_by_stream.values())


def upgrade() -> None:
    op.create_table(
        "telemetry_streams",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("vehicle_id", sa.Text(), nullable=False),
        sa.Column("packet_source", sa.Text(), nullable=True),
        sa.Column("receiver_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["vehicle_id"], ["telemetry_sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_telemetry_streams_vehicle_id", "telemetry_streams", ["vehicle_id"], unique=False)

    op.add_column("telemetry_data", sa.Column("packet_source", sa.Text(), nullable=True))
    op.add_column("telemetry_data", sa.Column("receiver_id", sa.Text(), nullable=True))
    op.add_column("telemetry_current", sa.Column("packet_source", sa.Text(), nullable=True))
    op.add_column("telemetry_current", sa.Column("receiver_id", sa.Text(), nullable=True))
    op.add_column("ops_events", sa.Column("stream_id", sa.Text(), nullable=True))
    op.create_index("ix_ops_events_stream_id", "ops_events", ["stream_id"], unique=False)

    bind = op.get_bind()
    telemetry_metadata = sa.table(
        "telemetry_metadata",
        sa.column("id", sa.Text()),
        sa.column("vehicle_id", sa.Text()),
    )
    telemetry_current = sa.table(
        "telemetry_current",
        sa.column("source_id", sa.Text()),
        sa.column("telemetry_id", sa.Text()),
        sa.column("generation_time"),
        sa.column("reception_time"),
        sa.column("packet_source", sa.Text()),
        sa.column("receiver_id", sa.Text()),
    )
    telemetry_data = sa.table(
        "telemetry_data",
        sa.column("source_id", sa.Text()),
        sa.column("telemetry_id", sa.Text()),
        sa.column("timestamp"),
        sa.column("packet_source", sa.Text()),
        sa.column("receiver_id", sa.Text()),
    )
    telemetry_streams = sa.table(
        "telemetry_streams",
        sa.column("id", sa.Text()),
        sa.column("vehicle_id", sa.Text()),
        sa.column("packet_source", sa.Text()),
        sa.column("receiver_id", sa.Text()),
        sa.column("status", sa.Text()),
        sa.column("started_at"),
        sa.column("last_seen_at"),
        sa.column("metadata"),
    )
    ops_events = sa.table(
        "ops_events",
        sa.column("id", sa.Text()),
        sa.column("source_id", sa.Text()),
        sa.column("stream_id", sa.Text()),
    )
    rows = bind.execute(sa.select(ops_events.c.id, ops_events.c.source_id)).fetchall()
    for row_id, legacy_source_id in rows:
        logical_vehicle_id, stream_id = _split_ops_event_source_id(legacy_source_id)
        if stream_id is None:
            continue
        bind.execute(
            ops_events.update()
            .where(ops_events.c.id == row_id)
            .values(source_id=logical_vehicle_id, stream_id=stream_id)
        )

    current_rows = bind.execute(
        sa.select(
            telemetry_current.c.source_id,
            telemetry_metadata.c.vehicle_id,
            sa.func.coalesce(telemetry_current.c.reception_time, telemetry_current.c.generation_time).label("observed_at"),
            telemetry_current.c.packet_source,
            telemetry_current.c.receiver_id,
        ).select_from(
            telemetry_current.join(telemetry_metadata, telemetry_metadata.c.id == telemetry_current.c.telemetry_id)
        )
    ).fetchall()
    data_rows = bind.execute(
        sa.select(
            telemetry_data.c.source_id,
            telemetry_metadata.c.vehicle_id,
            telemetry_data.c.timestamp.label("observed_at"),
            telemetry_data.c.packet_source,
            telemetry_data.c.receiver_id,
        ).select_from(
            telemetry_data.join(telemetry_metadata, telemetry_metadata.c.id == telemetry_data.c.telemetry_id)
        )
    ).fetchall()
    stream_rows = _collect_telemetry_stream_rows(current_rows, data_rows)
    if stream_rows:
        bind.execute(telemetry_streams.insert(), stream_rows)


def downgrade() -> None:
    op.drop_index("ix_ops_events_stream_id", table_name="ops_events")
    op.drop_column("ops_events", "stream_id")
    op.drop_column("telemetry_current", "receiver_id")
    op.drop_column("telemetry_current", "packet_source")
    op.drop_column("telemetry_data", "receiver_id")
    op.drop_column("telemetry_data", "packet_source")
    op.drop_index("ix_telemetry_streams_vehicle_id", table_name="telemetry_streams")
    op.drop_table("telemetry_streams")
