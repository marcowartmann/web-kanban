"""team_departments + user_team_departments

Revision ID: 0019
Revises: 0018
"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "team_departments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("team_id", sa.Integer,
                  sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("team_id", "name", name="uq_department_team_name"),
    )
    op.create_index("ix_team_departments_team_id", "team_departments", ["team_id"])
    op.create_table(
        "user_team_departments",
        sa.Column("user_id", sa.Integer,
                  sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("department_id", sa.Integer,
                  sa.ForeignKey("team_departments.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("user_team_departments")
    op.drop_index("ix_team_departments_team_id", table_name="team_departments")
    op.drop_table("team_departments")
