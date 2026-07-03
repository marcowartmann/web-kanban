"""containers: team+PI-scoped item grouping, with default seeding

Revision ID: 0016
Revises: 0015
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

DEFAULT_CONTAINER_NAMES = ("Operations", "Local Items", "Strategic Items")


def upgrade() -> None:
    op.create_table(
        "containers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("planning_interval", sa.String(64), nullable=False),
        sa.Column("team_id", sa.Integer,
                  sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("team_id", "planning_interval", "name",
                            name="uq_container_team_pi_name"),
    )
    op.create_index("ix_containers_planning_interval", "containers", ["planning_interval"])
    op.create_index("ix_containers_team_id", "containers", ["team_id"])

    op.add_column("items", sa.Column("container_id", sa.Integer, nullable=True))
    op.create_index("ix_items_container_id", "items", ["container_id"])
    op.create_foreign_key(
        "fk_items_container_id", "items", "containers",
        ["container_id"], ["id"], ondelete="SET NULL",
    )

    # Seed: the three defaults for every existing (team, PI) pair, plus
    # "Operational Stability" for PI1-Q3 only. Fresh databases have no
    # teams/PIs yet and get nothing.
    conn = op.get_bind()
    teams = sa.table("teams", sa.column("id", sa.Integer))
    pis = sa.table("planning_intervals", sa.column("name", sa.String))
    containers = sa.table(
        "containers",
        sa.column("name", sa.String),
        sa.column("planning_interval", sa.String),
        sa.column("team_id", sa.Integer),
    )
    team_ids = [row[0] for row in conn.execute(sa.select(teams.c.id))]
    pi_names = [row[0] for row in conn.execute(sa.select(pis.c.name))]
    rows = [
        {"name": name, "planning_interval": pi, "team_id": team_id}
        for team_id in team_ids
        for pi in pi_names
        for name in DEFAULT_CONTAINER_NAMES
    ]
    if "PI1-Q3" in pi_names:
        rows.extend(
            {"name": "Operational Stability", "planning_interval": "PI1-Q3", "team_id": team_id}
            for team_id in team_ids
        )
    if rows:
        conn.execute(sa.insert(containers), rows)


def downgrade() -> None:
    op.drop_constraint("fk_items_container_id", "items", type_="foreignkey")
    op.drop_index("ix_items_container_id", table_name="items")
    op.drop_column("items", "container_id")
    op.drop_index("ix_containers_team_id", table_name="containers")
    op.drop_index("ix_containers_planning_interval", table_name="containers")
    op.drop_table("containers")
