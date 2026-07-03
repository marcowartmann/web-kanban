from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    planning_interval: str | None = None
    iteration: int | None = None
    leading_team: str | None = None
    supporting_team: str | None = None
    container_id: int | None = None
    department_id: int | None = None
    externer_partner: str | None = None
    assignee_id: int | None = None
    akzeptanzkriterien: str | None = None
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
    # every field optional except version; only provided fields are changed
    model_config = ConfigDict(extra="forbid")
    version: int
    title: str | None = None
    description: str | None = None
    status: str | None = None
    position: int | None = None
    tshirt_size: str | None = None
    planning_interval: str | None = None
    iteration: int | None = Field(default=None, ge=1, le=6)
    leading_team: str | None = None
    supporting_team: str | None = None
    container_id: int | None = None
    department_id: int | None = None
    externer_partner: str | None = None
    assignee_id: int | None = None
    kategorie: str | None = None
    sdi_prio: str | None = None
    akzeptanzkriterien: str | None = None
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
    manual_rank: int | None = None
    version: int
    assignee: str | None = None
    department_name: str | None = None
    created_at: datetime
    updated_at: datetime


class ItemPage(BaseModel):
    items: list[ItemRead]
    total: int


class LinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: int
    target_id: int
    relation: str


class ItemRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    kind: ItemKind
    status: str | None = None
    planning_interval: str | None = None


class LinkedItem(BaseModel):
    link_id: int
    relation: str
    direction: str          # "outgoing" | "incoming"
    label: str
    item: ItemRef


class RelationOption(BaseModel):
    relation: str
    direction: str          # "outgoing" | "incoming" | "both"
    label: str


class LinkRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    source_id: int
    target_id: int
    relation: str


class ItemDetail(ItemRead):
    children: list[ItemRead] = []
    links: list[LinkedItem] = []


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


class ImportPreviewIncoming(BaseModel):
    features: int
    stories: int
    risks: int
    warnings: list[str]


class ImportPreviewCurrent(BaseModel):
    features: int
    stories: int
    risks: int
    comments: int
    links: int


class ImportPreview(BaseModel):
    file_sha256: str
    state_stamp: str
    incoming: ImportPreviewIncoming
    current: ImportPreviewCurrent
    added_titles: list[str]
    removed_titles: list[str]
    added_more: int
    removed_more: int


class SnapshotInfo(BaseModel):
    name: str
    created_at: str
    actor: str
    items: int
    comments: int
    links: int


class SnapshotList(BaseModel):
    snapshots: list[SnapshotInfo]


class RestoreResult(BaseModel):
    items: int
    comments: int
    links: int
    warnings: list[str]


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class TeamUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class TeamRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class PlanningIntervalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    position: int


class PlanningIntervalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class PlanningIntervalUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class ContainerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    planning_interval: str
    team_id: int


class ContainerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    planning_interval: str = Field(min_length=1, max_length=64)
    team_id: int


class ContainerUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class CapacityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    planning_interval: str
    iteration: int
    points: float


class CapacityUpsert(BaseModel):
    user_id: int
    planning_interval: str = Field(min_length=1, max_length=64)
    iteration: int = Field(ge=1, le=6)
    points: float = Field(ge=0)


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
    name: str = Field(min_length=1, max_length=128)


class LaneUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class LaneOrder(BaseModel):
    lane_ids: list[int]


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str | None
    username: str | None = None
    department_ids: list[int] = []
    display_name: str
    role: str
    is_active: bool
    auth_provider: str = "local"
    team_id: int | None = None
    team_name: str | None = None


class PersonOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    display_name: str
    team_id: int | None


class LoginRequest(BaseModel):
    username: str
    password: str
    method: Literal["local", "ldap"] = "ldap"


class FeatureReorderRequest(BaseModel):
    feature_id: int
    after_id: int | None = None


class DepartmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    team_id: int
    team_name: str
    member_ids: list[int]


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    team_id: int


class DepartmentRename(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class DepartmentMembers(BaseModel):
    user_ids: list[int]


class UserDepartments(BaseModel):
    department_ids: list[int]


def _password_fits_bcrypt(value: str | None) -> str | None:
    if value is None:
        return value
    if len(value.encode()) > 72:
        raise ValueError("password must be at most 72 bytes (multi-byte characters count extra)")
    return value


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)

    _check_new_password = field_validator("new_password")(_password_fits_bcrypt)


class UserCreate(BaseModel):
    email: str | None = Field(default=None, min_length=3, max_length=255)
    username: str | None = Field(default=None, min_length=1, max_length=150)
    display_name: str = Field(min_length=1, max_length=120)
    password: str | None = Field(default=None, min_length=8, max_length=72)
    role: Literal["admin", "member"] = "member"
    team_id: int | None = None

    _check_password = field_validator("password")(_password_fits_bcrypt)


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, min_length=3, max_length=255)
    username: str | None = Field(default=None, max_length=150)  # "" normalized to None in the handler
    team_id: int | None = None
    role: Literal["admin", "member"] | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str | None) -> str | None:
        return value if value is None else _password_fits_bcrypt(value)


class AuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    actor_name: str | None
    event_type: str
    entity_type: str
    entity_id: int | None
    entity_label: str | None
    field: str | None
    old_value: str | None
    new_value: str | None


class AuditPage(BaseModel):
    items: list[AuditEventRead]
    total: int


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_id: int
    parent_id: int | None
    author_id: int
    author_name: str | None
    body: str
    created_at: datetime
    updated_at: datetime | None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    parent_id: int | None = None


class CommentUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
