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


def downgrade() -> None:
    op.drop_index("ix_ops_events_stream_id", table_name="ops_events")
    op.drop_column("ops_events", "stream_id")
    op.drop_column("telemetry_current", "receiver_id")
    op.drop_column("telemetry_current", "packet_source")
    op.drop_column("telemetry_data", "receiver_id")
    op.drop_column("telemetry_data", "packet_source")
    op.drop_index("ix_telemetry_streams_vehicle_id", table_name="telemetry_streams")
    op.drop_table("telemetry_streams")
