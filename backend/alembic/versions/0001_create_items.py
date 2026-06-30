"""create items table

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("type", sa.String(64)),
        sa.Column("parent_id", sa.Integer,
                  sa.ForeignKey("items.id", ondelete="CASCADE")),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("kategorie", sa.String(256)),
        sa.Column("art", sa.String(64)),
        sa.Column("sdi_prio", sa.String(64)),
        sa.Column("status", sa.String(64)),
        sa.Column("tshirt_size", sa.String(16)),
        sa.Column("wsjf_score", sa.Numeric),
        sa.Column("story_points", sa.Numeric),
        sa.Column("iteration", sa.String(64)),
        sa.Column("leading_team", sa.String(128)),
        sa.Column("supporting_team", sa.String(128)),
        sa.Column("externer_partner", sa.String(128)),
        sa.Column("assignee", sa.String(128)),
        sa.Column("akzeptanzkriterien", sa.Text),
        sa.Column("dependencies", sa.Text),
        sa.Column("bo_stakeholder", sa.String(256)),
        sa.Column("business_value", sa.Integer),
        sa.Column("time_criticality", sa.Integer),
        sa.Column("risk_reduction", sa.Integer),
        sa.Column("cost_of_delay", sa.Numeric),
        sa.Column("job_size", sa.Numeric),
        sa.Column("definition_of_done", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_index("ix_items_parent_id", "items", ["parent_id"])
    op.create_index("ix_items_status", "items", ["status"])


def downgrade() -> None:
    op.drop_table("items")
