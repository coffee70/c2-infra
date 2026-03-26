"""Add channel-origin metadata for catalog and discovered telemetry.

Revision ID: 013
Revises: 012
Create Date: 2026-03-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "telemetry_metadata",
        sa.Column("channel_origin", sa.Text(), nullable=False, server_default="catalog"),
    )
    op.add_column(
        "telemetry_metadata",
        sa.Column("discovery_namespace", sa.Text(), nullable=True),
    )
    op.add_column(
        "telemetry_metadata",
        sa.Column("discovered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "telemetry_metadata",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "telemetry_metadata",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE telemetry_metadata SET channel_origin = 'catalog' WHERE channel_origin IS NULL")
    op.alter_column("telemetry_metadata", "channel_origin", server_default=None)


def downgrade() -> None:
    op.drop_column("telemetry_metadata", "archived_at")
    op.drop_column("telemetry_metadata", "last_seen_at")
    op.drop_column("telemetry_metadata", "discovered_at")
    op.drop_column("telemetry_metadata", "discovery_namespace")
    op.drop_column("telemetry_metadata", "channel_origin")
