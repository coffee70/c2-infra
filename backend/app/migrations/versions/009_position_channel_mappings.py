"""Create position_channel_mappings table for Earth view.

Revision ID: 009
Revises: 008
Create Date: 2026-03-09

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
  op.create_table(
      "position_channel_mappings",
      sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
      sa.Column("source_id", sa.Text(), sa.ForeignKey("telemetry_sources.id", ondelete="CASCADE"), nullable=False),
      sa.Column("frame_type", sa.Text(), nullable=False),
      sa.Column("lat_channel_name", sa.Text(), nullable=True),
      sa.Column("lon_channel_name", sa.Text(), nullable=True),
      sa.Column("alt_channel_name", sa.Text(), nullable=True),
      sa.Column("x_channel_name", sa.Text(), nullable=True),
      sa.Column("y_channel_name", sa.Text(), nullable=True),
      sa.Column("z_channel_name", sa.Text(), nullable=True),
      sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
      sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
      sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
  )
  op.create_index(
      "ix_position_channel_mappings_source_active",
      "position_channel_mappings",
      ["source_id", "active"],
  )


def downgrade() -> None:
  op.drop_index(
      "ix_position_channel_mappings_source_active",
      table_name="position_channel_mappings",
  )
  op.drop_table("position_channel_mappings")

