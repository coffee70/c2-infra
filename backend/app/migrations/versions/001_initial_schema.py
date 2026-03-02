"""Initial schema: telemetry_metadata, telemetry_data hypertable, telemetry_statistics.

Revision ID: 001
Revises:
Create Date: 2025-03-02

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Extensions are enabled in init-db.sql; ensure they exist
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # telemetry_metadata
    op.create_table(
        "telemetry_metadata",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("units", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("subsystem_tag", sa.Text(), nullable=True),
        sa.Column("embedding", Vector(384), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_telemetry_metadata_name"),
        "telemetry_metadata",
        ["name"],
        unique=True,
    )

    # telemetry_data (regular table first, then convert to hypertable)
    op.create_table(
        "telemetry_data",
        sa.Column("telemetry_id", sa.UUID(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Numeric(20, 10), nullable=False),
        sa.ForeignKeyConstraint(
            ["telemetry_id"],
            ["telemetry_metadata.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("telemetry_id", "timestamp"),
    )
    op.create_index(
        "ix_telemetry_data_telemetry_id_timestamp",
        "telemetry_data",
        ["telemetry_id", "timestamp"],
    )
    # Convert to TimescaleDB hypertable
    op.execute(
        "SELECT create_hypertable('telemetry_data', 'timestamp', "
        "if_not_exists => TRUE)"
    )

    # telemetry_statistics
    op.create_table(
        "telemetry_statistics",
        sa.Column("telemetry_id", sa.UUID(), nullable=False),
        sa.Column("mean", sa.Numeric(20, 10), nullable=False),
        sa.Column("std_dev", sa.Numeric(20, 10), nullable=False),
        sa.Column("min_value", sa.Numeric(20, 10), nullable=False),
        sa.Column("max_value", sa.Numeric(20, 10), nullable=False),
        sa.Column("p5", sa.Numeric(20, 10), nullable=False),
        sa.Column("p50", sa.Numeric(20, 10), nullable=False),
        sa.Column("p95", sa.Numeric(20, 10), nullable=False),
        sa.Column("last_computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["telemetry_id"],
            ["telemetry_metadata.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("telemetry_id"),
    )

    # ivfflat index on embedding - create after data is loaded for best performance
    # For empty table, we skip; run manually after loading: CREATE INDEX ix_telemetry_metadata_embedding
    # ON telemetry_metadata USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);


def downgrade() -> None:
    op.drop_table("telemetry_statistics")
    op.drop_table("telemetry_data")
    op.drop_index(
        op.f("ix_telemetry_metadata_name"),
        table_name="telemetry_metadata",
    )
    op.drop_table("telemetry_metadata")
