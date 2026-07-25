"""items.art text column -> art_id FK to arts, backfilling ART rows

Revision ID: 0026
Revises: 0025
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(
        "INSERT INTO arts (name) "
        "SELECT DISTINCT trim(art) FROM items "
        "WHERE art IS NOT NULL AND trim(art) <> '' "
        "ON CONFLICT (name) DO NOTHING"
    ))
    op.add_column("items", sa.Column("art_id", sa.Integer, nullable=True))
    conn.execute(sa.text(
        "UPDATE items SET art_id = arts.id FROM arts WHERE trim(items.art) = arts.name"
    ))
    op.create_index("ix_items_art_id", "items", ["art_id"])
    op.create_foreign_key(
        "fk_items_art_id", "items", "arts",
        ["art_id"], ["id"], ondelete="SET NULL",
    )
    op.drop_column("items", "art")


def downgrade() -> None:
    op.add_column("items", sa.Column("art", sa.String(64), nullable=True))
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE items SET art = arts.name FROM arts WHERE items.art_id = arts.id"
    ))
    op.drop_constraint("fk_items_art_id", "items", type_="foreignkey")
    op.drop_index("ix_items_art_id", table_name="items")
    op.drop_column("items", "art_id")
