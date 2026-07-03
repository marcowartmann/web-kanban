"""user.username: login identifier (uid for ldap), unique

Revision ID: 0017
Revises: 0016
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(150), nullable=True))
    # Backfill existing rows from the email local-part; suffix collisions with
    # the row id; rows with no email fall back to user-<id>.
    conn = op.get_bind()
    users = sa.table(
        "users",
        sa.column("id", sa.Integer),
        sa.column("email", sa.String),
        sa.column("username", sa.String),
    )
    seen: set[str] = set()
    for row in conn.execute(sa.select(users.c.id, users.c.email).order_by(users.c.id)):
        base = (row.email.split("@")[0] if row.email else "") or f"user-{row.id}"
        name = base if base not in seen else f"{base}-{row.id}"
        seen.add(name)
        conn.execute(sa.update(users).where(users.c.id == row.id).values(username=name))
    op.create_unique_constraint("uq_users_username", "users", ["username"])


def downgrade() -> None:
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_column("users", "username")
