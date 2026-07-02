"""reference integrity: drop legacy dependencies text, indexes, checks, not-null drift

Revision ID: 0012
Revises: 0011
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

# created_at columns whose migrations omitted nullable=False while the models
# are non-Optional (drift since 0006).
_NOT_NULL_FIXES = [
    "item_links",
    "planning_intervals",
    "users",
    "user_sessions",
    "audit_events",
    "comments",
]


def upgrade() -> None:
    op.drop_column("items", "dependencies")
    # ix_items_parent_id and ix_items_status already exist in Postgres (created
    # by migration 0001, undeclared in the model until now) — only these four
    # indexes are new. models.py still declares index=True on all six so the
    # SQLite create_all fixtures match the real database.
    op.create_index("ix_items_kind", "items", ["kind"])
    op.create_index("ix_items_planning_interval", "items", ["planning_interval"])
    op.create_index("ix_items_leading_team", "items", ["leading_team"])
    op.create_index("ix_items_assignee", "items", ["assignee"])
    op.create_check_constraint(
        "ck_capacities_iteration", "capacities", "iteration >= 1 AND iteration <= 6"
    )
    for table in _NOT_NULL_FIXES:
        op.execute(f"UPDATE {table} SET created_at = now() WHERE created_at IS NULL")
        op.alter_column(table, "created_at", existing_type=sa.DateTime(), nullable=False)


def downgrade() -> None:
    for table in reversed(_NOT_NULL_FIXES):
        op.alter_column(table, "created_at", existing_type=sa.DateTime(), nullable=True)
    op.drop_constraint("ck_capacities_iteration", "capacities", type_="check")
    # ix_items_parent_id / ix_items_status belong to migration 0001 — not dropped here.
    op.drop_index("ix_items_assignee", table_name="items")
    op.drop_index("ix_items_leading_team", table_name="items")
    op.drop_index("ix_items_planning_interval", table_name="items")
    op.drop_index("ix_items_kind", table_name="items")
    op.add_column("items", sa.Column("dependencies", sa.Text, nullable=True))
