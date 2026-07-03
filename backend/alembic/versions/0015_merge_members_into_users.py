"""Merge team_members into users; items.assignee -> assignee_id FK; capacities -> user_id.

Revision ID: 0015
Revises: 0014
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

_INSERT_PERSON = sa.text(
    "INSERT INTO users (email, display_name, password_hash, role, is_active, auth_provider, team_id, created_at) "
    "VALUES (NULL, :name, NULL, 'member', true, 'local', :team_id, now()) RETURNING id"
)

_FIND_USER = sa.text(
    "SELECT id, team_id FROM users WHERE display_name = :name ORDER BY id LIMIT 1"
)


def _resolve(bind, name: str, team_id=None) -> int:
    name = name[:120]  # users.display_name is String(120); sources allow 128
    row = bind.execute(_FIND_USER, {"name": name}).mappings().first()
    if row:
        return row["id"]
    return bind.execute(_INSERT_PERSON, {"name": name, "team_id": team_id}).scalar_one()


def upgrade() -> None:
    bind = op.get_bind()

    op.alter_column("users", "email", existing_type=sa.String(255), nullable=True)

    mapping: dict[int, int] = {}
    members = bind.execute(
        sa.text("SELECT id, name, team_id FROM team_members ORDER BY id")
    ).mappings().all()
    for m in members:
        name = m["name"][:120]  # align with users.display_name width
        row = bind.execute(_FIND_USER, {"name": name}).mappings().first()
        if row:
            mapping[m["id"]] = row["id"]
            if row["team_id"] is None and m["team_id"] is not None:
                bind.execute(
                    sa.text("UPDATE users SET team_id = :t WHERE id = :u"),
                    {"t": m["team_id"], "u": row["id"]},
                )
        else:
            mapping[m["id"]] = bind.execute(
                _INSERT_PERSON, {"name": name, "team_id": m["team_id"]}
            ).scalar_one()

    op.add_column(
        "items",
        sa.Column(
            "assignee_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_items_assignee_id", "items", ["assignee_id"])
    raw_names = bind.execute(
        sa.text(
            "SELECT DISTINCT assignee FROM items WHERE assignee IS NOT NULL AND trim(assignee) <> ''"
        )
    ).scalars().all()
    for raw in raw_names:
        clean = raw.strip()  # Python strip covers tabs/newlines the SQL trim() misses
        if not clean:
            continue
        uid = _resolve(bind, clean)
        bind.execute(
            sa.text("UPDATE items SET assignee_id = :u WHERE assignee = :raw"),
            {"u": uid, "raw": raw},
        )
    op.drop_index("ix_items_assignee", table_name="items")
    op.drop_column("items", "assignee")

    op.add_column(
        "capacities",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    for member_id, user_id in mapping.items():
        bind.execute(
            sa.text("UPDATE capacities SET user_id = :u WHERE member_id = :m"),
            {"u": user_id, "m": member_id},
        )
    op.alter_column("capacities", "user_id", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint("uq_capacity_member_pi_iter", "capacities", type_="unique")
    op.create_unique_constraint(
        "uq_capacity_user_pi_iter",
        "capacities",
        ["user_id", "planning_interval", "iteration"],
    )
    op.drop_column("capacities", "member_id")

    op.drop_table("team_members")


def downgrade() -> None:
    # Best-effort: merged members cannot be un-merged; inherited team_ids stay.
    bind = op.get_bind()

    op.create_table(
        "team_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="SET NULL")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_team_members_team_id", "team_members", ["team_id"])
    bind.execute(
        sa.text(
            "INSERT INTO team_members (name, team_id) "
            "SELECT DISTINCT ON (u.display_name) u.display_name, u.team_id FROM users u "
            "WHERE u.email IS NULL "
            "OR u.id IN (SELECT user_id FROM capacities) "
            "OR u.id IN (SELECT assignee_id FROM items WHERE assignee_id IS NOT NULL) "
            "ORDER BY u.display_name, u.id"
        )
    )

    op.add_column(
        "capacities",
        sa.Column(
            "member_id",
            sa.Integer(),
            sa.ForeignKey("team_members.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    bind.execute(
        sa.text(
            "UPDATE capacities SET member_id = tm.id FROM team_members tm, users u "
            "WHERE u.id = capacities.user_id AND tm.name = u.display_name"
        )
    )
    op.alter_column("capacities", "member_id", existing_type=sa.Integer(), nullable=False)
    op.create_index("ix_capacities_member_id", "capacities", ["member_id"])
    op.drop_constraint("uq_capacity_user_pi_iter", "capacities", type_="unique")
    op.create_unique_constraint(
        "uq_capacity_member_pi_iter",
        "capacities",
        ["member_id", "planning_interval", "iteration"],
    )
    op.drop_column("capacities", "user_id")

    op.add_column("items", sa.Column("assignee", sa.String(128), nullable=True))
    op.create_index("ix_items_assignee", "items", ["assignee"])
    bind.execute(
        sa.text(
            "UPDATE items SET assignee = u.display_name FROM users u "
            "WHERE items.assignee_id = u.id"
        )
    )
    op.drop_index("ix_items_assignee_id", table_name="items")
    op.drop_column("items", "assignee_id")

    bind.execute(sa.text("DELETE FROM users WHERE email IS NULL"))
    op.alter_column("users", "email", existing_type=sa.String(255), nullable=False)
