"""Initial baseline schema.

Revision ID: 001
Revises:
Create Date: 2026-04-01

"""

from alembic import op
from sqlalchemy import text

from app.database import Base
import app.models.telemetry  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE"))
    bind.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
