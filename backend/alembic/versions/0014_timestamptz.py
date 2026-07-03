"""Convert all datetime columns to timestamptz (stored values are UTC).

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

COLUMNS = [
    ("items", "created_at"),
    ("items", "updated_at"),
    ("item_links", "created_at"),
    ("teams", "created_at"),
    ("team_members", "created_at"),
    ("boards", "created_at"),
    ("lanes", "created_at"),
    ("planning_intervals", "created_at"),
    ("users", "created_at"),
    ("user_sessions", "created_at"),
    ("user_sessions", "expires_at"),
    ("audit_events", "created_at"),
    ("comments", "created_at"),
    ("comments", "updated_at"),
]


def upgrade() -> None:
    for table, col in COLUMNS:
        op.alter_column(
            table,
            col,
            existing_type=sa.DateTime(),
            type_=sa.DateTime(timezone=True),
            postgresql_using=f"{col} AT TIME ZONE 'UTC'",
        )


def downgrade() -> None:
    for table, col in COLUMNS:
        op.alter_column(
            table,
            col,
            existing_type=sa.DateTime(timezone=True),
            type_=sa.DateTime(),
            postgresql_using=f"{col} AT TIME ZONE 'UTC'",
        )
