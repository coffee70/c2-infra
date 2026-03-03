"""Add source_id for multi-source/vehicle support.

Revision ID: 005
Revises: 004
Create Date: 2025-03-02

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create telemetry_sources registry
    op.create_table(
        "telemetry_sources",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        "INSERT INTO telemetry_sources (id, name, description) VALUES "
        "('default', 'Default', 'Default telemetry source'), "
        "('mock_vehicle', 'Mock Vehicle', 'CLI mock streamer'), "
        "('simulator', 'Simulator', 'Mock vehicle simulator')"
    )

    # telemetry_current: add source_id, change PK to (source_id, telemetry_id)
    op.add_column(
        "telemetry_current",
        sa.Column("source_id", sa.Text(), nullable=True),
    )
    op.execute("UPDATE telemetry_current SET source_id = 'default' WHERE source_id IS NULL")
    op.alter_column(
        "telemetry_current",
        "source_id",
        nullable=False,
        server_default="default",
    )
    op.drop_constraint("telemetry_current_pkey", "telemetry_current", type_="primary")
    op.create_primary_key(
        "telemetry_current_pkey",
        "telemetry_current",
        ["source_id", "telemetry_id"],
    )

    # telemetry_alerts: add source_id
    op.add_column(
        "telemetry_alerts",
        sa.Column("source_id", sa.Text(), nullable=True),
    )
    op.execute("UPDATE telemetry_alerts SET source_id = 'default' WHERE source_id IS NULL")
    op.alter_column(
        "telemetry_alerts",
        "source_id",
        nullable=False,
        server_default="default",
    )
    op.create_index(
        op.f("ix_telemetry_alerts_source_id"),
        "telemetry_alerts",
        ["source_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_telemetry_alerts_source_id"),
        table_name="telemetry_alerts",
    )
    op.drop_column("telemetry_alerts", "source_id")

    op.drop_constraint("telemetry_current_pkey", "telemetry_current", type_="primary")
    op.create_primary_key("telemetry_current_pkey", "telemetry_current", ["telemetry_id"])
    op.drop_column("telemetry_current", "source_id")

    op.drop_table("telemetry_sources")
