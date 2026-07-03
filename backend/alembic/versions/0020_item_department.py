"""item.department_id → team_departments (SET NULL)

Revision ID: 0020
Revises: 0019
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("department_id", sa.Integer, nullable=True))
    op.create_index("ix_items_department_id", "items", ["department_id"])
    op.create_foreign_key(
        "fk_items_department_id", "items", "team_departments",
        ["department_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_items_department_id", "items", type_="foreignkey")
    op.drop_index("ix_items_department_id", table_name="items")
    op.drop_column("items", "department_id")
