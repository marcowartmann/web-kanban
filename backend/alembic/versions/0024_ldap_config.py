"""ldap_config

Revision ID: 0024
Revises: 0023

Creates the singleton ldap_config table. The row itself is seeded at app
startup (ensure_ldap_config) from the LDAP_* env vars, so existing env-configured
deployments carry their settings into the DB on first boot after upgrade.
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ldap_config",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("server_uri", sa.String(512), nullable=False, server_default="ldaps://ldap.internal:636"),
        sa.Column("start_tls", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("ca_cert", sa.Text),
        sa.Column("bind_dn", sa.String(512)),
        sa.Column("bind_password_enc", sa.Text),
        sa.Column("base_dn", sa.String(512), nullable=False, server_default=""),
        sa.Column("user_filter", sa.String(512), nullable=False,
                  server_default="(&(objectClass=inetOrgPerson)(uid={uid}))"),
        sa.Column("attr_email", sa.String(64), nullable=False, server_default="mail"),
        sa.Column("attr_display_name", sa.String(64), nullable=False, server_default="cn"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("ldap_config")
