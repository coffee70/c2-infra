"""Add red_low, red_high to telemetry_metadata and create watchlist table.

Revision ID: 002
Revises: 001
Create Date: 2025-03-02

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add red_low, red_high to telemetry_metadata
    op.add_column(
        "telemetry_metadata",
        sa.Column("red_low", sa.Numeric(20, 10), nullable=True),
    )
    op.add_column(
        "telemetry_metadata",
        sa.Column("red_high", sa.Numeric(20, 10), nullable=True),
    )

    # Create watchlist table
    op.create_table(
        "watchlist",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("telemetry_name", sa.Text(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_watchlist_telemetry_name",
        "watchlist",
        ["telemetry_name"],
        unique=True,
    )
    op.create_index(
        "ix_watchlist_display_order",
        "watchlist",
        ["display_order"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_watchlist_display_order", table_name="watchlist")
    op.drop_index("ix_watchlist_telemetry_name", table_name="watchlist")
    op.drop_table("watchlist")
    op.drop_column("telemetry_metadata", "red_high")
    op.drop_column("telemetry_metadata", "red_low")
