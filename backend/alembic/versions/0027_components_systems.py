"""vendors, components, systems, memberships, service tech links

Revision ID: 0027
Revises: 0026
"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vendors",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "components",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("model", sa.String(64)),
        sa.Column("description", sa.Text),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("vendor_id", sa.Integer, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("lifecycle_stage", sa.String(16), nullable=False, server_default="plan"),
        sa.Column("quantity", sa.Integer),
        sa.Column("eos_announced", sa.Date),
        sa.Column("end_of_sale", sa.Date),
        sa.Column("end_of_support", sa.Date),
        sa.Column("end_of_life", sa.Date),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "name", name="uq_component_product_name"),
    )
    op.create_index("ix_components_product_id", "components", ["product_id"])
    op.create_index("ix_components_vendor_id", "components", ["vendor_id"])
    op.create_table(
        "systems",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("lifecycle_stage", sa.String(16), nullable=False, server_default="plan"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "name", name="uq_system_product_name"),
    )
    op.create_index("ix_systems_product_id", "systems", ["product_id"])
    op.create_table(
        "system_components",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("system_id", sa.Integer, sa.ForeignKey("systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("component_id", sa.Integer, sa.ForeignKey("components.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Integer),
        sa.UniqueConstraint("system_id", "component_id", name="uq_system_component"),
    )
    op.create_index("ix_system_components_system_id", "system_components", ["system_id"])
    op.create_index("ix_system_components_component_id", "system_components", ["component_id"])
    op.create_table(
        "service_components",
        sa.Column("service_id", sa.Integer, sa.ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("component_id", sa.Integer, sa.ForeignKey("components.id", ondelete="RESTRICT"), primary_key=True),
    )
    op.create_table(
        "service_systems",
        sa.Column("service_id", sa.Integer, sa.ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("system_id", sa.Integer, sa.ForeignKey("systems.id", ondelete="RESTRICT"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("service_systems")
    op.drop_table("service_components")
    op.drop_table("system_components")
    op.drop_table("systems")
    op.drop_table("components")
    op.drop_table("vendors")
