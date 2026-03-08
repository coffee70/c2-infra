"""Add source_type and base_url to telemetry_sources.

Revision ID: 008
Revises: 007
Create Date: 2025-03-08

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "telemetry_sources",
        sa.Column("source_type", sa.Text(), nullable=True),
    )
    op.add_column(
        "telemetry_sources",
        sa.Column("base_url", sa.Text(), nullable=True),
    )
    op.execute(
        "UPDATE telemetry_sources SET source_type = 'vehicle' WHERE id IN ('default', 'mock_vehicle')"
    )
    op.execute(
        "UPDATE telemetry_sources SET source_type = 'simulator', base_url = 'http://simulator:8001' WHERE id = 'simulator'"
    )
    op.alter_column(
        "telemetry_sources",
        "source_type",
        nullable=False,
    )
    op.execute(
        "INSERT INTO telemetry_sources (id, name, description, source_type, base_url) VALUES "
        "('simulator2', 'Simulator 2', 'Second simulator instance', 'simulator', 'http://simulator2:8001')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM telemetry_sources WHERE id = 'simulator2'")
    op.drop_column("telemetry_sources", "base_url")
    op.drop_column("telemetry_sources", "source_type")
