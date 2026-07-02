"""optimistic locking: items.version

Revision ID: 0013
Revises: 0012
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "items",
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("items", "version")
