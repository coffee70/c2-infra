"""Add source-scoped telemetry channel aliases.

Revision ID: 014
Revises: 013
Create Date: 2026-03-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "telemetry_channel_aliases",
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column("alias_name", sa.Text(), nullable=False),
        sa.Column("telemetry_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["telemetry_sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["telemetry_id"], ["telemetry_metadata.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("source_id", "alias_name"),
    )
    op.create_index(
        "ix_telemetry_channel_aliases_source_alias",
        "telemetry_channel_aliases",
        ["source_id", "alias_name"],
        unique=True,
    )
    op.create_index(
        "ix_telemetry_channel_aliases_source_telemetry",
        "telemetry_channel_aliases",
        ["source_id", "telemetry_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_telemetry_channel_aliases_source_telemetry", table_name="telemetry_channel_aliases")
    op.drop_index("ix_telemetry_channel_aliases_source_alias", table_name="telemetry_channel_aliases")
    op.drop_table("telemetry_channel_aliases")
