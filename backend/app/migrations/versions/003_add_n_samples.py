"""Add n_samples to telemetry_statistics.

Revision ID: 003
Revises: 002
Create Date: 2025-03-02

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "telemetry_statistics",
        sa.Column("n_samples", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("telemetry_statistics", "n_samples")
