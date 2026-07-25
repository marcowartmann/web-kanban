"""catalog tables: arts, products, services, service_dependencies

Revision ID: 0025
Revises: 0024
"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "arts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
        sa.Column("description", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("description", sa.Text),
        sa.Column("art_id", sa.Integer, sa.ForeignKey("arts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id", ondelete="SET NULL"), unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_products_art_id", "products", ["art_id"])
    op.create_table(
        "services",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("parent_service_id", sa.Integer, sa.ForeignKey("services.id", ondelete="RESTRICT")),
        sa.Column("owner_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("lifecycle_state", sa.String(16), nullable=False, server_default="planned"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_services_product_id", "services", ["product_id"])
    op.create_index("ix_services_parent_service_id", "services", ["parent_service_id"])
    op.create_table(
        "service_dependencies",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("from_service_id", sa.Integer, sa.ForeignKey("services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("to_service_id", sa.Integer, sa.ForeignKey("services.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("dep_type", sa.String(16), nullable=False),
        sa.Column("criticality", sa.String(16), nullable=False),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("from_service_id", "to_service_id", name="uq_service_dependency"),
        sa.CheckConstraint("from_service_id != to_service_id", name="ck_service_dep_no_self"),
    )
    op.create_index("ix_service_dependencies_from_service_id", "service_dependencies", ["from_service_id"])
    op.create_index("ix_service_dependencies_to_service_id", "service_dependencies", ["to_service_id"])


def downgrade() -> None:
    op.drop_table("service_dependencies")
    op.drop_table("services")
    op.drop_table("products")
    op.drop_table("arts")
