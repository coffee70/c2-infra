"""Make telemetry_data and telemetry_statistics source-aware.

Revision ID: 006
Revises: 005
Create Date: 2025-03-02

Adds source_id to telemetry_data (hypertable) and telemetry_statistics.
Backfills existing rows with source_id='default'.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- telemetry_data (TimescaleDB hypertable) ---
    op.add_column(
        "telemetry_data",
        sa.Column("source_id", sa.Text(), nullable=True),
    )
    op.execute("UPDATE telemetry_data SET source_id = 'default' WHERE source_id IS NULL")
    op.alter_column(
        "telemetry_data",
        "source_id",
        nullable=False,
        server_default="default",
    )
    op.drop_constraint("telemetry_data_pkey", "telemetry_data", type_="primary")
    op.create_primary_key(
        "telemetry_data_pkey",
        "telemetry_data",
        ["source_id", "telemetry_id", "timestamp"],
    )
    op.drop_index(
        "ix_telemetry_data_telemetry_id_timestamp",
        table_name="telemetry_data",
    )
    op.create_index(
        "ix_telemetry_data_source_telemetry_timestamp",
        "telemetry_data",
        ["source_id", "telemetry_id", "timestamp"],
        unique=False,
    )

    # --- telemetry_statistics ---
    op.add_column(
        "telemetry_statistics",
        sa.Column("source_id", sa.Text(), nullable=True),
    )
    op.execute(
        "UPDATE telemetry_statistics SET source_id = 'default' WHERE source_id IS NULL"
    )
    op.alter_column(
        "telemetry_statistics",
        "source_id",
        nullable=False,
        server_default="default",
    )
    op.drop_constraint(
        "telemetry_statistics_pkey", "telemetry_statistics", type_="primary"
    )
    op.create_primary_key(
        "telemetry_statistics_pkey",
        "telemetry_statistics",
        ["source_id", "telemetry_id"],
    )


def downgrade() -> None:
    # --- telemetry_statistics ---
    op.drop_constraint(
        "telemetry_statistics_pkey", "telemetry_statistics", type_="primary"
    )
    op.create_primary_key(
        "telemetry_statistics_pkey",
        "telemetry_statistics",
        ["telemetry_id"],
    )
    op.drop_column("telemetry_statistics", "source_id")

    # --- telemetry_data ---
    op.drop_index(
        "ix_telemetry_data_source_telemetry_timestamp",
        table_name="telemetry_data",
    )
    op.create_index(
        "ix_telemetry_data_telemetry_id_timestamp",
        "telemetry_data",
        ["telemetry_id", "timestamp"],
        unique=False,
    )
    op.drop_constraint("telemetry_data_pkey", "telemetry_data", type_="primary")
    op.create_primary_key(
        "telemetry_data_pkey",
        "telemetry_data",
        ["telemetry_id", "timestamp"],
    )
    op.drop_column("telemetry_data", "source_id")
