from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.models import ItemKind


class ItemBase(BaseModel):
    title: str
    description: str | None = None
    type: str | None = None
    kategorie: str | None = None
    art: str | None = None
    sdi_prio: str | None = None
    status: str | None = None
    tshirt_size: str | None = None
    wsjf_score: float | None = None
    story_points: float | None = None
    iteration: str | None = None
    leading_team: str | None = None
    supporting_team: str | None = None
    externer_partner: str | None = None
    assignee: str | None = None
    akzeptanzkriterien: str | None = None
    dependencies: str | None = None
    bo_stakeholder: str | None = None
    business_value: int | None = None
    time_criticality: int | None = None
    risk_reduction: int | None = None
    cost_of_delay: float | None = None
    job_size: float | None = None
    definition_of_done: str | None = None


class ItemCreate(ItemBase):
    kind: ItemKind
    parent_id: int | None = None
    position: int = 0


class ItemUpdate(BaseModel):
    # every field optional; only provided fields are changed
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    description: str | None = None
    status: str | None = None
    position: int | None = None
    tshirt_size: str | None = None
    iteration: str | None = None
    leading_team: str | None = None
    supporting_team: str | None = None
    externer_partner: str | None = None
    assignee: str | None = None
    kategorie: str | None = None
    sdi_prio: str | None = None
    akzeptanzkriterien: str | None = None
    dependencies: str | None = None
    bo_stakeholder: str | None = None
    definition_of_done: str | None = None
    story_points: float | None = None
    business_value: int | None = None
    time_criticality: int | None = None
    risk_reduction: int | None = None
    job_size: float | None = None
    wsjf_score: float | None = None


class ItemRead(ItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: ItemKind
    parent_id: int | None
    position: int
    created_at: datetime
    updated_at: datetime


class ItemDetail(ItemRead):
    children: list[ItemRead] = []


class BoardCard(ItemRead):
    children_count: int = 0
    children_points: float = 0.0


class BoardColumn(BaseModel):
    status: str
    cards: list[BoardCard]


class ImportResult(BaseModel):
    features: int
    stories: int
    risks: int
    warnings: list[str]


class TeamCreate(BaseModel):
    name: str


class TeamRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class TeamMemberCreate(BaseModel):
    name: str
    team_id: int | None = None


class TeamMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    team_id: int | None
    team_name: str | None = None


class LaneRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    position: int


class BoardRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    kinds: list[str]
    position: int
    lanes: list[LaneRead]

    @field_validator("kinds", mode="before")
    @classmethod
    def _split_csv_kinds(cls, value: object) -> object:
        # Accept either the ORM's CSV string ("feature,story") or an already-split list.
        if isinstance(value, str):
            return [k for k in value.split(",") if k]
        return value


class LaneCreate(BaseModel):
    name: str


class LaneUpdate(BaseModel):
    name: str


class LaneOrder(BaseModel):
    lane_ids: list[int]
