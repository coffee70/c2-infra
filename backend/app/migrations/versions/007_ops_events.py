"""Add ops_events table for unified timeline.

Revision ID: 007
Revises: 006
Create Date: 2025-03-02

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ops_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("payload", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ops_events_source_time",
        "ops_events",
        ["source_id", "event_time"],
        unique=False,
    )
    op.create_index(
        "ix_ops_events_type_time",
        "ops_events",
        ["event_type", "event_time"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_ops_events_type_time", table_name="ops_events")
    op.drop_index("ix_ops_events_source_time", table_name="ops_events")
    op.drop_table("ops_events")
