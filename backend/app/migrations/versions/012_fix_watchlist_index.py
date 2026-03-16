"""Drop legacy global watchlist uniqueness and restore a non-unique telemetry index.

Revision ID: 012
Revises: 011
Create Date: 2026-03-14
"""

from typing import Sequence, Union

from alembic import op

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_watchlist_telemetry_name")
    op.execute("CREATE INDEX IF NOT EXISTS ix_watchlist_telemetry_name ON watchlist (telemetry_name)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_watchlist_telemetry_name")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_watchlist_telemetry_name ON watchlist (telemetry_name)")
