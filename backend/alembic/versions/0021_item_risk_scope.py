"""item.risk_scope (art/team), backfilled from kategorie

Revision ID: 0021
Revises: 0020
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("risk_scope", sa.String(16), nullable=True))
    op.execute(
        "UPDATE items SET risk_scope = 'art' "
        "WHERE kind = 'RISK' AND lower(kategorie) LIKE '%art risk%'"
    )
    op.execute(
        "UPDATE items SET risk_scope = 'team' "
        "WHERE kind = 'RISK' AND lower(kategorie) LIKE '%team risk%'"
    )


def downgrade() -> None:
    op.drop_column("items", "risk_scope")
