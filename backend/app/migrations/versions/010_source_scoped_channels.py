"""Make telemetry metadata and watchlist source-scoped.

Revision ID: 010
Revises: 009
Create Date: 2026-03-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "telemetry_metadata",
        sa.Column("source_id", sa.Text(), nullable=True, server_default="default"),
    )
    op.execute("UPDATE telemetry_metadata SET source_id = 'default' WHERE source_id IS NULL")
    op.alter_column("telemetry_metadata", "source_id", nullable=False, server_default=None)
    op.create_foreign_key(
        "fk_telemetry_metadata_source_id",
        "telemetry_metadata",
        "telemetry_sources",
        ["source_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_index(op.f("ix_telemetry_metadata_name"), table_name="telemetry_metadata")
    op.create_index("ix_telemetry_metadata_name", "telemetry_metadata", ["name"], unique=False)
    op.create_index(
        "ix_telemetry_metadata_source_name",
        "telemetry_metadata",
        ["source_id", "name"],
        unique=True,
    )

    op.add_column(
        "watchlist",
        sa.Column("source_id", sa.Text(), nullable=True, server_default="default"),
    )
    op.execute("UPDATE watchlist SET source_id = 'default' WHERE source_id IS NULL")
    op.alter_column("watchlist", "source_id", nullable=False, server_default=None)
    op.create_foreign_key(
        "fk_watchlist_source_id",
        "watchlist",
        "telemetry_sources",
        ["source_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_watchlist_source_id", "watchlist", ["source_id"], unique=False)
    op.create_index(
        "ix_watchlist_source_telemetry_name",
        "watchlist",
        ["source_id", "telemetry_name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_watchlist_source_telemetry_name", table_name="watchlist")
    op.drop_index("ix_watchlist_source_id", table_name="watchlist")
    op.drop_constraint("fk_watchlist_source_id", "watchlist", type_="foreignkey")
    op.drop_column("watchlist", "source_id")

    op.drop_index("ix_telemetry_metadata_source_name", table_name="telemetry_metadata")
    op.drop_constraint("fk_telemetry_metadata_source_id", "telemetry_metadata", type_="foreignkey")
    op.drop_index("ix_telemetry_metadata_name", table_name="telemetry_metadata")
    op.create_index(op.f("ix_telemetry_metadata_name"), "telemetry_metadata", ["name"], unique=True)
    op.drop_column("telemetry_metadata", "source_id")
