"""pi_objectives + pi_objective_features

Revision ID: 0022
Revises: 0021
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pi_objectives",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("planning_interval_id", sa.Integer, sa.ForeignKey("planning_intervals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("state", sa.String(32), nullable=False, server_default="uncommitted"),
        sa.Column("is_key_delivery", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pi_objectives_team_id", "pi_objectives", ["team_id"])
    op.create_index("ix_pi_objectives_planning_interval_id", "pi_objectives", ["planning_interval_id"])
    op.create_index("ix_pi_objectives_state", "pi_objectives", ["state"])
    op.create_table(
        "pi_objective_features",
        sa.Column("pi_objective_id", sa.Integer, sa.ForeignKey("pi_objectives.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("item_id", sa.Integer, sa.ForeignKey("items.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("pi_objective_features")
    op.drop_index("ix_pi_objectives_state", table_name="pi_objectives")
    op.drop_index("ix_pi_objectives_planning_interval_id", table_name="pi_objectives")
    op.drop_index("ix_pi_objectives_team_id", table_name="pi_objectives")
    op.drop_table("pi_objectives")
