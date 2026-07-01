"""rename iteration to planning_interval and add iteration slot

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The old free-text `iteration` actually held the Planning Interval.
    op.alter_column("items", "iteration", new_column_name="planning_interval")
    # New per-story iteration slot within a PI (1..5, 6 = IP); null = backlog.
    op.add_column("items", sa.Column("iteration", sa.Integer, nullable=True))


def downgrade() -> None:
    op.drop_column("items", "iteration")
    op.alter_column("items", "planning_interval", new_column_name="iteration")
