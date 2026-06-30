"""create teams and team_members

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_table(
        "team_members",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("team_id", sa.Integer,
                  sa.ForeignKey("teams.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_index("ix_team_members_team_id", "team_members", ["team_id"])


def downgrade() -> None:
    op.drop_table("team_members")
    op.drop_table("teams")
