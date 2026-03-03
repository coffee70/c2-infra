"""Add telemetry_current, telemetry_alerts, telemetry_alert_notes for realtime.

Revision ID: 004
Revises: 003
Create Date: 2025-03-02

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "telemetry_current",
        sa.Column("telemetry_id", sa.UUID(), nullable=False),
        sa.Column("generation_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reception_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Numeric(20, 10), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("state_reason", sa.Text(), nullable=True),
        sa.Column("z_score", sa.Numeric(20, 10), nullable=True),
        sa.Column("quality", sa.Text(), nullable=False, server_default="valid"),
        sa.Column("sequence", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["telemetry_id"],
            ["telemetry_metadata.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("telemetry_id"),
    )

    op.create_table(
        "telemetry_alerts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("telemetry_id", sa.UUID(), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("opened_reception_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_update_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("current_value_at_open", sa.Numeric(20, 10), nullable=False),
        sa.Column("acked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acked_by", sa.Text(), nullable=True),
        sa.Column("cleared_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Text(), nullable=True),
        sa.Column("resolution_text", sa.Text(), nullable=True),
        sa.Column("resolution_code", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["telemetry_id"],
            ["telemetry_metadata.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_telemetry_alerts_telemetry_id"),
        "telemetry_alerts",
        ["telemetry_id"],
        unique=False,
    )

    op.create_table(
        "telemetry_alert_notes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("alert_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("author", sa.Text(), nullable=False),
        sa.Column("note_text", sa.Text(), nullable=False),
        sa.Column("note_type", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["alert_id"],
            ["telemetry_alerts.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_telemetry_alert_notes_alert_id"),
        "telemetry_alert_notes",
        ["alert_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_telemetry_alert_notes_alert_id"),
        table_name="telemetry_alert_notes",
    )
    op.drop_table("telemetry_alert_notes")
    op.drop_index(
        op.f("ix_telemetry_alerts_telemetry_id"),
        table_name="telemetry_alerts",
    )
    op.drop_table("telemetry_alerts")
    op.drop_table("telemetry_current")
