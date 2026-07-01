"""item dependency links

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_links",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source_id", sa.Integer,
                  sa.ForeignKey("items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_id", sa.Integer,
                  sa.ForeignKey("items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.UniqueConstraint("source_id", "target_id", "relation", name="uq_item_link"),
    )
    op.create_index("ix_item_links_source_id", "item_links", ["source_id"])
    op.create_index("ix_item_links_target_id", "item_links", ["target_id"])


def downgrade() -> None:
    op.drop_table("item_links")
