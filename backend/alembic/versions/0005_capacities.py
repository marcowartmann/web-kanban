"""member capacity per planning interval and iteration

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "capacities",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("member_id", sa.Integer,
                  sa.ForeignKey("team_members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("planning_interval", sa.String(64), nullable=False),
        sa.Column("iteration", sa.Integer, nullable=False),
        sa.Column("points", sa.Numeric, nullable=False),
        sa.UniqueConstraint("member_id", "planning_interval", "iteration",
                            name="uq_capacity_member_pi_iter"),
    )
    op.create_index("ix_capacities_member_id", "capacities", ["member_id"])


def downgrade() -> None:
    op.drop_table("capacities")
