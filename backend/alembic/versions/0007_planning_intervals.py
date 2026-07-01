"""planning intervals master list

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "planning_intervals",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    # Seed from the distinct planning_interval values already on items.
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT DISTINCT planning_interval FROM items "
            "WHERE planning_interval IS NOT NULL AND planning_interval <> ''"
        )
    ).fetchall()
    for position, name in enumerate(sorted(r[0] for r in rows)):
        bind.execute(
            sa.text("INSERT INTO planning_intervals (name, position) VALUES (:name, :position)"),
            {"name": name, "position": position},
        )


def downgrade() -> None:
    op.drop_table("planning_intervals")
