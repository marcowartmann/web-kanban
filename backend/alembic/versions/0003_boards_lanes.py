"""create boards and lanes

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "boards",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("kinds", sa.String(128), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_table(
        "lanes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("board_id", sa.Integer,
                  sa.ForeignKey("boards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(),
                  nullable=False),
        sa.UniqueConstraint("board_id", "name", name="uq_lane_board_name"),
    )
    op.create_index("ix_lanes_board_id", "lanes", ["board_id"])


def downgrade() -> None:
    op.drop_table("lanes")
    op.drop_table("boards")
