"""support contracts + component budget fields

Revision ID: 0028
Revises: 0027
"""
from alembic import op
import sqlalchemy as sa

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "support_contracts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("contract_no", sa.String(64)),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("vendor_id", sa.Integer, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("start_date", sa.Date),
        sa.Column("end_date", sa.Date),
        sa.Column("yearly_cost", sa.Numeric),
        sa.Column("notice_period_days", sa.Integer),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "name", name="uq_contract_product_name"),
    )
    op.create_index("ix_support_contracts_product_id", "support_contracts", ["product_id"])
    op.create_index("ix_support_contracts_vendor_id", "support_contracts", ["vendor_id"])
    op.create_table(
        "contract_components",
        sa.Column("contract_id", sa.Integer, sa.ForeignKey("support_contracts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("component_id", sa.Integer, sa.ForeignKey("components.id", ondelete="RESTRICT"), primary_key=True),
    )
    op.add_column("components", sa.Column("yearly_run_cost", sa.Numeric))
    op.add_column("components", sa.Column("replacement_budget", sa.Numeric))


def downgrade() -> None:
    op.drop_column("components", "replacement_budget")
    op.drop_column("components", "yearly_run_cost")
    op.drop_table("contract_components")
    op.drop_table("support_contracts")
