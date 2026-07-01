import enum
from datetime import datetime

from sqlalchemy import Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class ItemKind(str, enum.Enum):
    FEATURE = "feature"
    STORY = "story"
    RISK = "risk"


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[ItemKind] = mapped_column(Enum(ItemKind, native_enum=False))
    type: Mapped[str | None] = mapped_column(String(64))
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE")
    )
    position: Mapped[int] = mapped_column(Integer, default=0)

    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(Text)
    kategorie: Mapped[str | None] = mapped_column(String(256))
    art: Mapped[str | None] = mapped_column(String(64))
    sdi_prio: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str | None] = mapped_column(String(64))
    tshirt_size: Mapped[str | None] = mapped_column(String(16))
    wsjf_score: Mapped[float | None] = mapped_column(Numeric)
    story_points: Mapped[float | None] = mapped_column(Numeric)
    planning_interval: Mapped[str | None] = mapped_column(String(64))
    iteration: Mapped[int | None] = mapped_column(Integer)
    leading_team: Mapped[str | None] = mapped_column(String(128))
    supporting_team: Mapped[str | None] = mapped_column(String(128))
    externer_partner: Mapped[str | None] = mapped_column(String(128))
    assignee: Mapped[str | None] = mapped_column(String(128))
    akzeptanzkriterien: Mapped[str | None] = mapped_column(Text)
    dependencies: Mapped[str | None] = mapped_column(Text)
    bo_stakeholder: Mapped[str | None] = mapped_column(String(256))
    business_value: Mapped[int | None] = mapped_column(Integer)
    time_criticality: Mapped[int | None] = mapped_column(Integer)
    risk_reduction: Mapped[int | None] = mapped_column(Integer)
    cost_of_delay: Mapped[float | None] = mapped_column(Numeric)
    job_size: Mapped[float | None] = mapped_column(Numeric)
    definition_of_done: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )

    children: Mapped[list["Item"]] = relationship(
        cascade="all, delete-orphan",
        order_by="Item.position",
    )


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    members: Mapped[list["TeamMember"]] = relationship(back_populates="team")


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    team: Mapped["Team | None"] = relationship(back_populates="members")


class Board(Base):
    __tablename__ = "boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    kinds: Mapped[str] = mapped_column(String(128))  # CSV, e.g. "feature,story"
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

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
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    board: Mapped["Board"] = relationship(back_populates="lanes")
