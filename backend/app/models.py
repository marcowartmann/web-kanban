import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
# DateTime is app.timeutil's tz-normalizing TypeDecorator — never import DateTime
# from sqlalchemy for a column, or SQLite reads it back naive.
from app.timeutil import DateTime, utcnow


class ItemKind(str, enum.Enum):
    FEATURE = "feature"
    STORY = "story"
    RISK = "risk"


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[ItemKind] = mapped_column(Enum(ItemKind, native_enum=False), index=True)
    type: Mapped[str | None] = mapped_column(String(64))
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(Text)
    kategorie: Mapped[str | None] = mapped_column(String(256))
    art: Mapped[str | None] = mapped_column(String(64))
    sdi_prio: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str | None] = mapped_column(String(64), index=True)
    tshirt_size: Mapped[str | None] = mapped_column(String(16))
    wsjf_score: Mapped[float | None] = mapped_column(Numeric)
    story_points: Mapped[float | None] = mapped_column(Numeric)
    planning_interval: Mapped[str | None] = mapped_column(String(64), index=True)
    iteration: Mapped[int | None] = mapped_column(Integer)
    leading_team: Mapped[str | None] = mapped_column(String(128), index=True)
    supporting_team: Mapped[str | None] = mapped_column(String(128))
    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    externer_partner: Mapped[str | None] = mapped_column(String(128))
    akzeptanzkriterien: Mapped[str | None] = mapped_column(Text)
    bo_stakeholder: Mapped[str | None] = mapped_column(String(256))
    business_value: Mapped[int | None] = mapped_column(Integer)
    time_criticality: Mapped[int | None] = mapped_column(Integer)
    risk_reduction: Mapped[int | None] = mapped_column(Integer)
    cost_of_delay: Mapped[float | None] = mapped_column(Numeric)
    job_size: Mapped[float | None] = mapped_column(Numeric)
    definition_of_done: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )

    __mapper_args__ = {"version_id_col": version}

    children: Mapped[list["Item"]] = relationship(
        cascade="all, delete-orphan",
        order_by="Item.position",
    )
    comments: Mapped[list["Comment"]] = relationship(
        cascade="all, delete-orphan",
    )

    assignee_user: Mapped["User | None"] = relationship(foreign_keys=[assignee_id])

    @property
    def assignee(self) -> str | None:
        return self.assignee_user.display_name if self.assignee_user else None


class ItemLink(Base):
    __tablename__ = "item_links"
    __table_args__ = (
        UniqueConstraint("source_id", "target_id", "relation", name="uq_item_link"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
    target_id: Mapped[int] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
    relation: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )

    members: Mapped[list["TeamMember"]] = relationship(back_populates="team")


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )

    team: Mapped["Team | None"] = relationship(back_populates="members")

    capacities: Mapped[list["Capacity"]] = relationship(
        cascade="all, delete-orphan"
    )


class Capacity(Base):
    __tablename__ = "capacities"
    __table_args__ = (
        UniqueConstraint(
            "member_id", "planning_interval", "iteration",
            name="uq_capacity_member_pi_iter",
        ),
        CheckConstraint("iteration >= 1 AND iteration <= 6", name="ck_capacities_iteration"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    member_id: Mapped[int] = mapped_column(
        ForeignKey("team_members.id", ondelete="CASCADE")
    )
    planning_interval: Mapped[str] = mapped_column(String(64))
    iteration: Mapped[int] = mapped_column(Integer)  # 1..5, 6 = IP
    points: Mapped[float] = mapped_column(Numeric)


class Board(Base):
    __tablename__ = "boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    kinds: Mapped[str] = mapped_column(String(128))  # CSV, e.g. "feature,story"
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )

    lanes: Mapped[list["Lane"]] = relationship(
        back_populates="board",
        cascade="all, delete-orphan",
        order_by="Lane.position",
    )


class Lane(Base):
    __tablename__ = "lanes"
    __table_args__ = (UniqueConstraint("board_id", "name", name="uq_lane_board_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(128))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )

    board: Mapped["Board"] = relationship(back_populates="lanes")


class PlanningInterval(Base):
    __tablename__ = "planning_intervals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)  # lowercase; NULL = cannot log in
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255))  # None for future IdP users
    role: Mapped[str] = mapped_column(String(16), default="member")  # 'admin' | 'member'
    is_active: Mapped[bool] = mapped_column(default=True)
    auth_provider: Mapped[str] = mapped_column(String(16), default="local")  # 'oidc' later
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )

    # No back_populates: Team.members already pairs with TeamMember.team.
    team: Mapped["Team | None"] = relationship()

    @property
    def team_name(self) -> str | None:
        return self.team.name if self.team else None


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # sha256 hex
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AuditEvent(Base):
    """Immutable audit trail. Deliberately NO foreign keys: rows must survive
    deletion of the items/teams/users they describe (snapshots carry names)."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), index=True
    )
    actor_id: Mapped[int | None] = mapped_column(Integer)
    actor_name: Mapped[str | None] = mapped_column(String(120))
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    entity_type: Mapped[str] = mapped_column(String(20))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    entity_label: Mapped[str | None] = mapped_column(String(500))
    field: Mapped[str | None] = mapped_column(String(40))
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("ix_audit_events_entity", "entity_type", "entity_id"),)


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # set on edit

    author: Mapped["User"] = relationship()
    replies: Mapped[list["Comment"]] = relationship(
        cascade="all, delete-orphan",
        order_by="Comment.id",
    )

    @property
    def author_name(self) -> str | None:
        return self.author.display_name if self.author else None
