# Teams / Team Members Admin + Assignee Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add globally-configurable Teams and Team Members (new tables + CRUD API + an Admin UI), seed them from imported data, and make the item Assignee a strict searchable dropdown of configured members.

**Architecture:** Two new tables (`teams`, `team_members`) with member→team `ON DELETE SET NULL`. Item `assignee` stays a free-text name; a strict `SearchableSelect` only lets you pick configured members. CSV import idempotently get-or-creates teams/members from existing values (never deletes). The frontend adds a Board⇄Admin view toggle (no router) with Teams and Team Members sections.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, Alembic (backend); React + Vite + TS + Tailwind, Vitest (frontend).

## Global Constraints

- Python 3.14+; SQLAlchemy 2.0 declarative (`Mapped`/`mapped_column`); Pydantic v2 (`ConfigDict(from_attributes=True)` on read schemas).
- All API routes prefixed `/api`.
- New tables only; `items` is unchanged. Item `assignee` remains a free-text String.
- `teams.name` and `team_members.name` are **unique, not null**. `team_members.team_id` is a nullable FK → `teams.id` with `ON DELETE SET NULL`.
- Import seeding is **idempotent and additive** (get-or-create; never deletes existing teams/members).
- Frontend: backend calls go only through `src/api/client.ts`; TypeScript `strict: true`.
- Assignee dropdown is **strict**: only configured member names are selectable; clearing sets it to empty.
- Backend tests run on SQLite (`conftest` `db_session`/`client` fixtures); prod uses Postgres via Alembic.

---

### Task 1: Team & TeamMember models + schemas

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/schemas.py`
- Create: `backend/tests/test_team_models.py`

**Interfaces:**
- Consumes: `app.db.Base`.
- Produces: `app.models.Team` (`id, name, created_at, members`), `app.models.TeamMember` (`id, name, team_id, created_at, team`); schemas `TeamCreate`, `TeamRead`, `TeamMemberCreate`, `TeamMemberRead`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_team_models.py`

```python
from app.models import Team, TeamMember


def test_member_belongs_to_team(db_session):
    team = Team(name="Network")
    db_session.add(team)
    db_session.flush()
    member = TeamMember(name="Marco Wartmann", team_id=team.id)
    db_session.add(member)
    db_session.commit()
    assert db_session.get(TeamMember, member.id).team.name == "Network"


def test_member_without_team(db_session):
    member = TeamMember(name="Solo")
    db_session.add(member)
    db_session.commit()
    assert db_session.get(TeamMember, member.id).team_id is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_team_models.py -q`
Expected: FAIL — `ImportError: cannot import name 'Team'`.

- [ ] **Step 3: Append the models to `backend/app/models.py`** (after the `Item` class; reuse the existing imports `Integer, String, ForeignKey, func, datetime, Mapped, mapped_column, relationship`)

```python
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
```

- [ ] **Step 4: Append the schemas to `backend/app/schemas.py`** (end of file; `BaseModel`, `ConfigDict` are already imported)

```python
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_team_models.py -q`
Expected: PASS — both tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/tests/test_team_models.py
git commit -m "feat(backend): add Team/TeamMember models and schemas"
```

---

### Task 2: Teams router

**Files:**
- Create: `backend/app/routers/teams.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_api_teams.py`

**Interfaces:**
- Consumes: `Team`, `TeamMember`, `TeamCreate`, `TeamRead`, `get_db`.
- Produces: `GET /api/teams`, `POST /api/teams` (409 on dup), `DELETE /api/teams/{id}` (404 if missing; nulls members' `team_id`).

- [ ] **Step 1: Write the failing test** — `backend/tests/test_api_teams.py`

```python
from app.models import Team, TeamMember


def test_create_list_delete_team(client):
    resp = client.post("/api/teams", json={"name": "Network"})
    assert resp.status_code == 201
    team_id = resp.json()["id"]
    assert [t["name"] for t in client.get("/api/teams").json()] == ["Network"]
    assert client.delete(f"/api/teams/{team_id}").status_code == 204
    assert client.get("/api/teams").json() == []


def test_duplicate_team_returns_409(client):
    client.post("/api/teams", json={"name": "Network"})
    assert client.post("/api/teams", json={"name": "Network"}).status_code == 409


def test_delete_missing_team_returns_404(client):
    assert client.delete("/api/teams/999").status_code == 404


def test_delete_team_nulls_its_members(client, db_session):
    team = Team(name="Network")
    db_session.add(team)
    db_session.flush()
    member = TeamMember(name="Marco", team_id=team.id)
    db_session.add(member)
    db_session.commit()
    assert client.delete(f"/api/teams/{team.id}").status_code == 204
    db_session.expire_all()
    assert db_session.get(TeamMember, member.id).team_id is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_api_teams.py -q`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Create `backend/app/routers/teams.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Team, TeamMember
from app.schemas import TeamCreate, TeamRead

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("", response_model=list[TeamRead])
def list_teams(db: Session = Depends(get_db)) -> list[Team]:
    return list(db.scalars(select(Team).order_by(Team.name)))


@router.post("", response_model=TeamRead, status_code=201)
def create_team(payload: TeamCreate, db: Session = Depends(get_db)) -> Team:
    if db.scalar(select(Team).where(Team.name == payload.name)):
        raise HTTPException(status_code=409, detail="Team already exists")
    team = Team(name=payload.name)
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@router.delete("/{team_id}", status_code=204)
def delete_team(team_id: int, db: Session = Depends(get_db)) -> None:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    # Detach members explicitly (DB also enforces ON DELETE SET NULL).
    for member in db.scalars(select(TeamMember).where(TeamMember.team_id == team_id)):
        member.team_id = None
    db.delete(team)
    db.commit()
```

- [ ] **Step 4: Register the router in `backend/app/main.py`**

```python
from app.routers import teams

app.include_router(teams.router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_api_teams.py -q`
Expected: PASS — four tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/teams.py backend/app/main.py backend/tests/test_api_teams.py
git commit -m "feat(backend): add teams CRUD endpoints"
```

---

### Task 3: Team members router

**Files:**
- Create: `backend/app/routers/team_members.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_api_team_members.py`

**Interfaces:**
- Consumes: `Team`, `TeamMember`, `TeamMemberCreate`, `TeamMemberRead`, `get_db`.
- Produces: `GET /api/team-members` (each with `team_name`), `POST /api/team-members` (422 bad `team_id`, 409 dup), `DELETE /api/team-members/{id}` (404 if missing).

- [ ] **Step 1: Write the failing test** — `backend/tests/test_api_team_members.py`

```python
from app.models import Team


def test_create_member_without_team(client):
    resp = client.post("/api/team-members", json={"name": "Solo"})
    assert resp.status_code == 201
    assert resp.json()["team_id"] is None
    assert resp.json()["team_name"] is None


def test_create_member_with_team_and_list_includes_team_name(client, db_session):
    team = Team(name="Network")
    db_session.add(team)
    db_session.commit()
    resp = client.post("/api/team-members", json={"name": "Marco", "team_id": team.id})
    assert resp.status_code == 201
    body = client.get("/api/team-members").json()
    assert body[0]["name"] == "Marco"
    assert body[0]["team_name"] == "Network"


def test_create_member_bad_team_returns_422(client):
    resp = client.post("/api/team-members", json={"name": "X", "team_id": 999})
    assert resp.status_code == 422


def test_duplicate_member_returns_409(client):
    client.post("/api/team-members", json={"name": "Marco"})
    assert client.post("/api/team-members", json={"name": "Marco"}).status_code == 409


def test_delete_member(client):
    member_id = client.post("/api/team-members", json={"name": "Marco"}).json()["id"]
    assert client.delete(f"/api/team-members/{member_id}").status_code == 204
    assert client.get("/api/team-members").json() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_api_team_members.py -q`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Create `backend/app/routers/team_members.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Team, TeamMember
from app.schemas import TeamMemberCreate, TeamMemberRead

router = APIRouter(prefix="/api/team-members", tags=["team-members"])


def _to_read(member: TeamMember) -> TeamMemberRead:
    return TeamMemberRead(
        id=member.id,
        name=member.name,
        team_id=member.team_id,
        team_name=member.team.name if member.team else None,
    )


@router.get("", response_model=list[TeamMemberRead])
def list_members(db: Session = Depends(get_db)) -> list[TeamMemberRead]:
    members = db.scalars(select(TeamMember).order_by(TeamMember.name))
    return [_to_read(m) for m in members]


@router.post("", response_model=TeamMemberRead, status_code=201)
def create_member(
    payload: TeamMemberCreate, db: Session = Depends(get_db)
) -> TeamMemberRead:
    if payload.team_id is not None and db.get(Team, payload.team_id) is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    if db.scalar(select(TeamMember).where(TeamMember.name == payload.name)):
        raise HTTPException(status_code=409, detail="Member already exists")
    member = TeamMember(name=payload.name, team_id=payload.team_id)
    db.add(member)
    db.commit()
    db.refresh(member)
    return _to_read(member)


@router.delete("/{member_id}", status_code=204)
def delete_member(member_id: int, db: Session = Depends(get_db)) -> None:
    member = db.get(TeamMember, member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    db.commit()
```

- [ ] **Step 4: Register the router in `backend/app/main.py`**

```python
from app.routers import team_members

app.include_router(team_members.router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_api_team_members.py -q`
Expected: PASS — five tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/team_members.py backend/app/main.py backend/tests/test_api_team_members.py
git commit -m "feat(backend): add team-members CRUD endpoints"
```

---

### Task 4: Seed teams + members on import

**Files:**
- Modify: `backend/app/csv_import.py`
- Modify: `backend/tests/test_import_endpoint.py`

**Interfaces:**
- Consumes: `ParsedImport`, `Team`, `TeamMember`.
- Produces: `replace_all` now also idempotently get-or-creates `Team` rows (from `leading_team` + comma-split `supporting_team`) and `TeamMember` rows (from `assignee`), without deleting existing ones.

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_import_endpoint.py`

Add this import near the top of the file (below the existing imports):
```python
from sqlalchemy import select

from app.models import Team, TeamMember
```

Append these tests:
```python
def test_import_seeds_members_and_teams(client, db_session):
    with FIXTURE.open("rb") as fh:
        client.post("/api/import", files={"file": ("p.csv", fh, "text/csv")})
    members = {m.name for m in db_session.scalars(select(TeamMember))}
    assert "Marco Wartmann" in members
    teams = {t.name for t in db_session.scalars(select(Team))}
    assert "Network" in teams


def test_reimport_is_idempotent_and_keeps_manual_members(client, db_session):
    db_session.add(TeamMember(name="Manual Person"))
    db_session.commit()
    for _ in range(2):
        with FIXTURE.open("rb") as fh:
            client.post("/api/import", files={"file": ("p.csv", fh, "text/csv")})
    names = [m.name for m in db_session.scalars(select(TeamMember).order_by(TeamMember.name))]
    assert names.count("Marco Wartmann") == 1
    assert "Manual Person" in names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_import_endpoint.py -q`
Expected: FAIL — `"Marco Wartmann" not in members` (seeding not implemented).

- [ ] **Step 3: Add the seeding to `backend/app/csv_import.py`**

Add `from sqlalchemy import select` to the imports at the top of the module (if not present). Then add this helper above `replace_all`:

```python
def _seed_teams_and_members(db, parsed) -> None:
    from app.models import Team, TeamMember

    all_data = []
    for feature in parsed.features:
        all_data.append(feature.data)
        all_data.extend(story.data for story in feature.stories)
    all_data.extend(risk.data for risk in parsed.risks)

    team_names: set[str] = set()
    for data in all_data:
        for field in ("leading_team", "supporting_team"):
            raw = data.get(field)
            if raw:
                for token in str(raw).split(","):
                    token = token.strip()
                    if token:
                        team_names.add(token)
    existing_teams = {t.name for t in db.scalars(select(Team))}
    for name in team_names - existing_teams:
        db.add(Team(name=name))

    member_names: set[str] = set()
    for data in all_data:
        assignee = data.get("assignee")
        if assignee and str(assignee).strip():
            member_names.add(str(assignee).strip())
    existing_members = {m.name for m in db.scalars(select(TeamMember))}
    for name in member_names - existing_members:
        db.add(TeamMember(name=name))
```

In `replace_all`, call it just before the final `db.commit()`:
```python
    _seed_teams_and_members(db, parsed)
    db.commit()
```
(The `db.commit()` line already exists at the end of `replace_all`; add the `_seed_teams_and_members(db, parsed)` call immediately above it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && . .venv/bin/activate && pytest tests/test_import_endpoint.py -q`
Expected: PASS — all import tests (including the two new ones).

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && . .venv/bin/activate && pytest -q`
Expected: PASS — every backend test.

- [ ] **Step 6: Commit**

```bash
git add backend/app/csv_import.py backend/tests/test_import_endpoint.py
git commit -m "feat(backend): seed teams and members from CSV import (idempotent)"
```

---

### Task 5: Alembic migration 0002

**Files:**
- Create: `backend/alembic/versions/0002_teams_team_members.py`

**Interfaces:**
- Produces: a migration creating `teams` and `team_members` matching the models, chained after `0001`.

- [ ] **Step 1: Create `backend/alembic/versions/0002_teams_team_members.py`**

```python
"""create teams and team_members

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_table(
        "team_members",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("team_id", sa.Integer,
                  sa.ForeignKey("teams.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_index("ix_team_members_team_id", "team_members", ["team_id"])


def downgrade() -> None:
    op.drop_table("team_members")
    op.drop_table("teams")
```

- [ ] **Step 2: Verify the migration generates valid offline SQL**

Run: `cd backend && . .venv/bin/activate && alembic upgrade head --sql`
Expected: output includes `CREATE TABLE teams (` and `CREATE TABLE team_members (` with `team_id` referencing `teams(id)`; no error.

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/0002_teams_team_members.py
git commit -m "feat(backend): alembic migration for teams and team_members"
```

---

### Task 6: Frontend types + API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: types `Team`, `TeamMember`; client `getTeams`, `createTeam`, `deleteTeam`, `getTeamMembers`, `createTeamMember`, `deleteTeamMember`.

- [ ] **Step 1: Add types to `frontend/src/types.ts`** (end of file)

```ts
export interface Team {
  id: number;
  name: string;
}

export interface TeamMember {
  id: number;
  name: string;
  team_id: number | null;
  team_name: string | null;
}
```

- [ ] **Step 2: Add client functions to `frontend/src/api/client.ts`**

Update the type import line to include the new types:
```ts
import type {
  BoardColumn,
  ImportResult,
  Item,
  ItemCreate,
  ItemUpdate,
  Team,
  TeamMember,
} from "../types";
```
Append these functions (the `request` and `json` helpers already exist):
```ts
export function getTeams(): Promise<Team[]> {
  return request<Team[]>("/api/teams");
}

export function createTeam(name: string): Promise<Team> {
  return request<Team>("/api/teams", json({ name }));
}

export function deleteTeam(id: number): Promise<void> {
  return request<void>(`/api/teams/${id}`, { method: "DELETE" });
}

export function getTeamMembers(): Promise<TeamMember[]> {
  return request<TeamMember[]>("/api/team-members");
}

export function createTeamMember(body: {
  name: string;
  team_id?: number | null;
}): Promise<TeamMember> {
  return request<TeamMember>("/api/team-members", json(body));
}

export function deleteTeamMember(id: number): Promise<void> {
  return request<void>(`/api/team-members/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 3: Add client tests** — append to `frontend/src/api/client.test.ts` (inside the existing `describe("api client", ...)` block, before its closing `});`)

```ts
  it("getTeams fetches /api/teams", async () => {
    const spy = mockFetch(200, [{ id: 1, name: "Network" }]);
    const teams = await getTeams();
    expect(spy).toHaveBeenCalledWith("/api/teams", undefined);
    expect(teams[0].name).toBe("Network");
  });

  it("createTeamMember posts name + team_id", async () => {
    const spy = mockFetch(201, { id: 1, name: "Marco", team_id: 2, team_name: "Network" });
    await createTeamMember({ name: "Marco", team_id: 2 });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/team-members");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "Marco", team_id: 2 });
  });
```
Update the import at the top of the test file to include the new functions:
```ts
import { createItem, createTeamMember, getBoard, getTeams, importCsv, updateItem } from "./client";
```

- [ ] **Step 4: Run the client tests**

Run: `cd frontend && npm run test -- src/api/client.test.ts`
Expected: PASS — the existing 5 plus the 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(frontend): types + API client for teams and team members"
```

---

### Task 7: SearchableSelect (strict combobox)

**Files:**
- Create: `frontend/src/components/SearchableSelect.tsx`
- Create: `frontend/src/components/SearchableSelect.test.tsx`

**Interfaces:**
- Produces: `SearchableSelect({ value: string | null; options: string[]; onChange: (v: string | null) => void; placeholder?: string })`.

- [ ] **Step 1: Write the failing test** — `frontend/src/components/SearchableSelect.test.tsx`

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SearchableSelect from "./SearchableSelect";

const options = ["Marco Wartmann", "Adrian Senn"];

it("filters options as you type", () => {
  render(<SearchableSelect value={null} options={options} onChange={() => {}} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "adr" } });
  expect(screen.getByText("Adrian Senn")).toBeInTheDocument();
  expect(screen.queryByText("Marco Wartmann")).toBeNull();
});

it("commits a clicked option via onChange", () => {
  const onChange = vi.fn();
  render(<SearchableSelect value={null} options={options} onChange={onChange} />);
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.mouseDown(screen.getByText("Marco Wartmann"));
  expect(onChange).toHaveBeenCalledWith("Marco Wartmann");
});

it("clear button sets null", () => {
  const onChange = vi.fn();
  render(<SearchableSelect value="Marco Wartmann" options={options} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /clear/i }));
  expect(onChange).toHaveBeenCalledWith(null);
});

it("does not commit free text (strict)", () => {
  const onChange = vi.fn();
  render(<SearchableSelect value={null} options={options} onChange={onChange} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Nobody" } });
  expect(onChange).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/components/SearchableSelect.test.tsx`
Expected: FAIL — cannot resolve `./SearchableSelect`.

- [ ] **Step 3: Create `frontend/src/components/SearchableSelect.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";

export default function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Search…",
}: {
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? "");
  const ref = useRef<HTMLDivElement>(null);

  // While closed, the input mirrors the committed value (strict: discards typing).
  useEffect(() => {
    if (!open) setQuery(value ?? "");
  }, [value, open]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const filtered = open
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  const commit = (name: string) => {
    onChange(name);
    setQuery(name);
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1">
        <input
          role="combobox"
          aria-expanded={open}
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
        {value && (
          <button
            aria-label="Clear assignee"
            onClick={clear}
            className="px-1 text-gray-400 hover:text-red-600"
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-gray-200 bg-white shadow">
          {filtered.length === 0 && (
            <li className="px-2 py-1 text-xs text-gray-400">No matches</li>
          )}
          {filtered.map((o) => (
            <li key={o}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(o);
                }}
                className="block w-full px-2 py-1 text-left text-sm hover:bg-blue-50"
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- src/components/SearchableSelect.test.tsx`
Expected: PASS — four tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SearchableSelect.tsx frontend/src/components/SearchableSelect.test.tsx
git commit -m "feat(frontend): strict searchable select component"
```

---

### Task 8: Admin view (Teams + Team Members sections)

**Files:**
- Create: `frontend/src/components/admin/TeamsSection.tsx`
- Create: `frontend/src/components/admin/TeamMembersSection.tsx`
- Create: `frontend/src/components/admin/AdminView.tsx`
- Create: `frontend/src/components/admin/AdminView.test.tsx`

**Interfaces:**
- Consumes: client `getTeams/createTeam/deleteTeam/getTeamMembers/createTeamMember/deleteTeamMember`.
- Produces: `AdminView({ onChanged: () => void })` rendering both sections.

- [ ] **Step 1: Write the failing test** — `frontend/src/components/admin/AdminView.test.tsx`

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import AdminView from "./AdminView";

afterEach(() => vi.restoreAllMocks());

it("adds a team", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([]);
  vi.spyOn(client, "getTeamMembers").mockResolvedValue([]);
  const create = vi.spyOn(client, "createTeam").mockResolvedValue({ id: 1, name: "Network" });
  render(<AdminView onChanged={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/new team name/i), { target: { value: "Network" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  await waitFor(() => expect(create).toHaveBeenCalledWith("Network"));
});

it("adds a member with a team", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([{ id: 2, name: "Network" }]);
  vi.spyOn(client, "getTeamMembers").mockResolvedValue([]);
  const create = vi.spyOn(client, "createTeamMember").mockResolvedValue({
    id: 1, name: "Marco", team_id: 2, team_name: "Network",
  });
  render(<AdminView onChanged={() => {}} />);
  await screen.findByRole("option", { name: "Network" });
  fireEvent.change(screen.getByPlaceholderText(/new member name/i), { target: { value: "Marco" } });
  fireEvent.change(screen.getByLabelText(/^team$/i), { target: { value: "2" } });
  fireEvent.click(screen.getAllByRole("button", { name: /^add$/i })[1]);
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({ name: "Marco", team_id: 2 }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/components/admin/AdminView.test.tsx`
Expected: FAIL — cannot resolve `./AdminView`.

- [ ] **Step 3: Create `frontend/src/components/admin/TeamsSection.tsx`**

```tsx
import { useEffect, useState } from "react";
import { createTeam, deleteTeam, getTeams } from "../../api/client";
import type { Team } from "../../types";

export default function TeamsSection({ onChanged }: { onChanged: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState("");

  const reload = () => void getTeams().then(setTeams);
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim()) return;
    await createTeam(name.trim());
    setName("");
    reload();
    onChanged();
  };

  const remove = async (id: number) => {
    await deleteTeam(id);
    reload();
    onChanged();
  };

  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Teams</h2>
      <div className="mb-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New team name"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <button onClick={add} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          Add
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {teams.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm"
          >
            <span>{t.name}</span>
            <button
              aria-label={`remove team ${t.id}`}
              onClick={() => remove(t.id)}
              className="text-gray-400 hover:text-red-600"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Create `frontend/src/components/admin/TeamMembersSection.tsx`**

```tsx
import { useEffect, useState } from "react";
import {
  createTeamMember,
  deleteTeamMember,
  getTeamMembers,
  getTeams,
} from "../../api/client";
import type { Team, TeamMember } from "../../types";

export default function TeamMembersSection({ onChanged }: { onChanged: () => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");

  const reload = () => {
    void getTeamMembers().then(setMembers);
    void getTeams().then(setTeams);
  };
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim()) return;
    await createTeamMember({
      name: name.trim(),
      team_id: teamId ? Number(teamId) : null,
    });
    setName("");
    setTeamId("");
    reload();
    onChanged();
  };

  const remove = async (id: number) => {
    await deleteTeamMember(id);
    reload();
    onChanged();
  };

  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Team Members</h2>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New member name"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <select
          aria-label="Team"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button onClick={add} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          Add
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm"
          >
            <span>
              {m.name}
              {m.team_name && <span className="text-gray-400"> — {m.team_name}</span>}
            </span>
            <button
              aria-label={`remove member ${m.id}`}
              onClick={() => remove(m.id)}
              className="text-gray-400 hover:text-red-600"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Create `frontend/src/components/admin/AdminView.tsx`**

```tsx
import TeamMembersSection from "./TeamMembersSection";
import TeamsSection from "./TeamsSection";

export default function AdminView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="grid gap-4 p-6 md:grid-cols-2">
      <TeamsSection onChanged={onChanged} />
      <TeamMembersSection onChanged={onChanged} />
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npm run test -- src/components/admin/AdminView.test.tsx`
Expected: PASS — both tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/admin/
git commit -m "feat(frontend): admin view with teams and team-members sections"
```

---

### Task 9: App nav (Board/Admin) + Assignee dropdown in drawer

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/ItemDrawer.tsx`
- Create: `frontend/src/components/ItemDrawerAssignee.test.tsx`

**Interfaces:**
- Consumes: `AdminView`, `SearchableSelect`, `getTeamMembers`.
- Produces: a Board⇄Admin toggle; `ItemDrawer` gains `assigneeOptions?: string[]` and renders the Assignee dropdown.

- [ ] **Step 1: Write the failing test** — `frontend/src/components/ItemDrawerAssignee.test.tsx`

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const item = {
  id: 5, kind: "feature", type: "Feature", title: "F", status: "Analyzing",
  wsjf_score: null, business_value: null, time_criticality: null,
  risk_reduction: null, cost_of_delay: null, job_size: null, parent_id: null,
  position: 0, description: null, iteration: null, leading_team: null,
  story_points: null, tshirt_size: null, kategorie: null, art: null,
  sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null,
  definition_of_done: null, children: [],
};

it("assigns a team member from the strict dropdown and saves it", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(item as never);
  render(
    <ItemDrawer
      itemId={5}
      assigneeOptions={["Marco Wartmann", "Adrian Senn"]}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  await screen.findByDisplayValue("F");
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.mouseDown(screen.getByText("Marco Wartmann"));
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ assignee: "Marco Wartmann" }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/components/ItemDrawerAssignee.test.tsx`
Expected: FAIL — there is no `combobox` (Assignee is still a plain text Field).

- [ ] **Step 3: Update `frontend/src/components/ItemDrawer.tsx`**

Add the import:
```tsx
import SearchableSelect from "./SearchableSelect";
```
Change the component signature to accept the options prop:
```tsx
export default function ItemDrawer({
  itemId,
  assigneeOptions = [],
  onClose,
  onChanged,
}: {
  itemId: number;
  assigneeOptions?: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
```
Replace the Assignee `Field` line:
```tsx
        <Field label="Assignee" value={value("assignee")} onChange={(v) => set("assignee", v)} />
```
with:
```tsx
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Assignee</span>
          <SearchableSelect
            value={(value("assignee") as string | null) || null}
            options={assigneeOptions}
            onChange={(v) => setDraft((d) => ({ ...d, assignee: v ?? "" }))}
            placeholder="Search team member…"
          />
        </label>
```

- [ ] **Step 4: Run the drawer assignee test to verify it passes**

Run: `cd frontend && npm run test -- src/components/ItemDrawerAssignee.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire nav + member fetching in `frontend/src/App.tsx`**

Replace the file with:
```tsx
import { useEffect, useState } from "react";
import Board from "./components/Board";
import ImportButton from "./components/ImportButton";
import ItemDrawer from "./components/ItemDrawer";
import NewItemBar from "./components/NewItemBar";
import StoryBoardModal from "./components/StoryBoardModal";
import Toolbar, { type BoardFilters } from "./components/Toolbar";
import AdminView from "./components/admin/AdminView";
import { getTeamMembers, listItems } from "./api/client";

export default function App() {
  const [view, setView] = useState<"board" | "admin">("board");
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [openStoriesFeatureId, setOpenStoriesFeatureId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState<BoardFilters>({ kinds: ["feature", "risk"] });
  const [iterations, setIterations] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([]);

  useEffect(() => {
    void listItems().then((items) => {
      setIterations([...new Set(items.map((i) => i.iteration).filter(Boolean) as string[])].sort());
      setTeams([...new Set(items.map((i) => i.leading_team).filter(Boolean) as string[])].sort());
    });
    void getTeamMembers().then((ms) => setAssigneeOptions(ms.map((m) => m.name)));
  }, [refreshKey]);

  const handleChanged = () => {
    setOpenItemId(null);
    setRefreshKey((k) => k + 1);
  };

  const navButton = (target: "board" | "admin", label: string) => (
    <button
      onClick={() => setView(target)}
      className={`rounded px-3 py-1 text-sm font-medium ${
        view === target ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
          <nav className="flex gap-1">
            {navButton("board", "Board")}
            {navButton("admin", "Admin")}
          </nav>
        </div>
        {view === "board" && (
          <div className="flex items-center gap-3">
            <ImportButton onImported={handleChanged} />
            <NewItemBar onCreated={handleChanged} />
          </div>
        )}
      </header>

      {view === "board" ? (
        <>
          <Toolbar filters={filters} onChange={setFilters} iterations={iterations} teams={teams} />
          <Board
            key={refreshKey}
            filters={filters}
            onOpenCard={setOpenItemId}
            onOpenStories={setOpenStoriesFeatureId}
          />
        </>
      ) : (
        <AdminView onChanged={handleChanged} />
      )}

      {openStoriesFeatureId != null && (
        <StoryBoardModal
          featureId={openStoriesFeatureId}
          refreshSignal={refreshKey}
          onClose={() => setOpenStoriesFeatureId(null)}
          onOpenItem={setOpenItemId}
          onChanged={handleChanged}
        />
      )}
      {openItemId != null && (
        <ItemDrawer
          itemId={openItemId}
          assigneeOptions={assigneeOptions}
          onClose={() => setOpenItemId(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the FULL frontend suite + build**

Run: `cd frontend && npm run test && npm run build`
Expected: PASS — every test; `tsc --noEmit` clean and Vite emits `dist/`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/ItemDrawer.tsx frontend/src/components/ItemDrawerAssignee.test.tsx
git commit -m "feat(frontend): Board/Admin nav and strict Assignee dropdown in drawer"
```

---

## Self-Review Notes

- **Spec coverage:** tables/model → Task 1; teams CRUD → Task 2; team-members CRUD + `team_name` → Task 3; idempotent import seeding (members + teams) → Task 4; migration → Task 5; types/client → Task 6; strict `SearchableSelect` → Task 7; Admin view (Teams + Members sections) → Task 8; Board⇄Admin nav + Assignee dropdown wired for all item kinds → Task 9. `assignee` stays text (Task 1/9); delete-team-nulls-members (Task 2). Out-of-scope items (Leading/Supporting Team dropdowns, auth) correctly absent.
- **Type consistency:** `Team`/`TeamMember` shapes match backend `TeamRead`/`TeamMemberRead`; client fn names match their uses in Tasks 8–9; `SearchableSelect` prop signature matches its uses; `ItemDrawer` `assigneeOptions?: string[]` consistent.
- **Placeholders:** none — every step carries complete code.
- **Note for reviewers:** existing `ItemDrawer.test.tsx` / `ItemDrawerStories.test.tsx` render `ItemDrawer` without `assigneeOptions` (defaults to `[]`); the Assignee becomes a combobox but those tests don't touch it, so they remain valid.
