"""backup_config + backup_runs

Revision ID: 0023
Revises: 0022
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "backup_config",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("sftp_host", sa.String(255)),
        sa.Column("sftp_port", sa.Integer, nullable=False, server_default="22"),
        sa.Column("sftp_username", sa.String(255)),
        sa.Column("sftp_password_enc", sa.Text),
        sa.Column("remote_dir", sa.String(512), nullable=False, server_default="upload"),
        sa.Column("include_db", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("include_snapshots", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("schedule_frequency", sa.String(16), nullable=False, server_default="disabled"),
        sa.Column("schedule_day_of_week", sa.Integer, nullable=False, server_default="0"),
        sa.Column("schedule_time", sa.String(5), nullable=False, server_default="02:00"),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute("INSERT INTO backup_config (id) VALUES (1)")
    op.create_table(
        "backup_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("db_file", sa.String(255)),
        sa.Column("snapshots_file", sa.String(255)),
        sa.Column("message", sa.Text),
    )


def downgrade() -> None:
    op.drop_table("backup_runs")
    op.drop_table("backup_config")
