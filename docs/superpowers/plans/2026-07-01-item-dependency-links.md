# Item Dependency Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add directed, typed dependency links between any two items (feature/story/risk) with an add/remove UI in the item drawer and blocked-by badges on board cards.

**Architecture:** A new `item_links(source_id, target_id, relation)` table stores directed edges. Relation types (`blocks`, `relates_to`) live in an app-level Python registry — new types need no migration. The backend exposes link CRUD + a resolved `links` array on item detail; the frontend edits links in the drawer and computes card badges client-side from a fetched links list.

**Tech Stack:** Backend — Python 3.14, FastAPI, SQLAlchemy 2.0 (`Mapped`/`mapped_column`), Pydantic v2, Alembic, pytest. Frontend — React + TypeScript, Vitest + Testing Library, Tailwind.

## Global Constraints

- Relation types are defined in `app/links.py` `RELATIONS` — adding one must NOT require a DB migration (column is `String(32)`, not an enum).
- The free-text `Item.dependencies` column is **retained, not migrated**. Structured links are additive.
- Seed relations only: `blocks` (directional) and `relates_to` (symmetric). No others.
- No cycle enforcement. Only self-links and exact duplicates are rejected.
- Symmetric relations are canonicalized on write (store once with `source_id < target_id`).
- Cross-kind links are unrestricted (any kind ↔ any kind).
- Link cleanup on item delete must be **explicit** in `delete_item` (tests run on SQLite with FK enforcement off; the FK `ON DELETE CASCADE` is defense-in-depth for prod Postgres).
- New Alembic migration is `0006`, `down_revision = "0005"`.
- Tests use the existing `client` / `db_session` fixtures (in-memory SQLite; `Base.metadata.create_all` builds new tables automatically, so API tests need no migration run).

---

### Task 1: Relation registry (`app/links.py`)

**Files:**
- Create: `backend/app/links.py`
- Test: `backend/tests/test_links_registry.py`

**Interfaces:**
- Produces:
  - `Relation` dataclass: `Relation(forward: str, inverse: str, symmetric: bool)`
  - `RELATIONS: dict[str, Relation]`
  - `relation_options() -> list[dict[str, str]]` — items shaped `{"relation", "direction", "label"}`, `direction ∈ {"outgoing","incoming","both"}`
  - `canonicalize(source_id: int, target_id: int, relation: str) -> tuple[int, int]`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_links_registry.py`:

```python
from app.links import RELATIONS, canonicalize, relation_options


def test_seed_relations_present():
    assert set(RELATIONS) == {"blocks", "relates_to"}
    assert RELATIONS["blocks"].symmetric is False
    assert RELATIONS["relates_to"].symmetric is True


def test_relation_options_expands_directional_and_symmetric():
    opts = relation_options()
    assert {"relation": "blocks", "direction": "outgoing", "label": "blocks"} in opts
    assert {"relation": "blocks", "direction": "incoming", "label": "blocked by"} in opts
    assert {"relation": "relates_to", "direction": "both", "label": "relates to"} in opts
    # symmetric relation contributes exactly one option
    assert sum(o["relation"] == "relates_to" for o in opts) == 1


def test_canonicalize_orders_symmetric_pair():
    assert canonicalize(5, 2, "relates_to") == (2, 5)
    assert canonicalize(2, 5, "relates_to") == (2, 5)


def test_canonicalize_leaves_directional_untouched():
    assert canonicalize(5, 2, "blocks") == (5, 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend python -m pytest tests/test_links_registry.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.links'`.

(If pytest is missing in the container, install once: `docker compose exec -T backend pip install -q "pytest>=8.2" "httpx>=0.27"`. Tests are not baked into the image — copy them in before running: `docker compose cp ./backend/tests backend:/app/tests`. Re-copy after editing tests.)

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/links.py`:

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class Relation:
    forward: str   # label shown on the source end
    inverse: str   # label shown on the target end
    symmetric: bool


RELATIONS: dict[str, Relation] = {
    "blocks": Relation(forward="blocks", inverse="blocked by", symmetric=False),
    "relates_to": Relation(forward="relates to", inverse="relates to", symmetric=True),
}


def relation_options() -> list[dict[str, str]]:
    """Directed picker options for the UI, derived from the registry."""
    options: list[dict[str, str]] = []
    for key, rel in RELATIONS.items():
        if rel.symmetric:
            options.append({"relation": key, "direction": "both", "label": rel.forward})
        else:
            options.append({"relation": key, "direction": "outgoing", "label": rel.forward})
            options.append({"relation": key, "direction": "incoming", "label": rel.inverse})
    return options


def canonicalize(source_id: int, target_id: int, relation: str) -> tuple[int, int]:
    """For symmetric relations, order the pair so the smaller id is the source."""
    rel = RELATIONS[relation]
    if rel.symmetric and source_id > target_id:
        return target_id, source_id
    return source_id, target_id
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T backend python -m pytest tests/test_links_registry.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/links.py backend/tests/test_links_registry.py
git commit -m "feat(backend): relation registry for item links"
```

---

### Task 2: `ItemLink` model + migration `0006`

**Files:**
- Modify: `backend/app/models.py` (add `ItemLink` after the `Item` class)
- Create: `backend/alembic/versions/0006_item_links.py`
- Test: `backend/tests/test_item_link_model.py`

**Interfaces:**
- Produces: `ItemLink` ORM model with columns `id, source_id, target_id, relation, created_at`; table `item_links`; unique constraint `uq_item_link` on `(source_id, target_id, relation)`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_item_link_model.py`:

```python
from app.models import Item, ItemKind, ItemLink


def _item(db, kind, title):
    it = Item(kind=kind, title=title)
    db.add(it)
    db.commit()
    db.refresh(it)
    return it


def test_item_link_roundtrip(db_session):
    a = _item(db_session, ItemKind.FEATURE, "A")
    b = _item(db_session, ItemKind.STORY, "B")
    link = ItemLink(source_id=a.id, target_id=b.id, relation="blocks")
    db_session.add(link)
    db_session.commit()
    db_session.refresh(link)
    assert link.id is not None
    assert link.created_at is not None
    assert db_session.query(ItemLink).count() == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_item_link_model.py -q`
Expected: FAIL — `ImportError: cannot import name 'ItemLink'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/models.py`, add this class immediately after the `Item` class (all imports it needs — `Integer, String, ForeignKey, UniqueConstraint, func, Mapped, mapped_column, datetime` — are already imported at the top of the file):

```python
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
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

Create `backend/alembic/versions/0006_item_links.py`:

```python
"""item dependency links

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_links",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source_id", sa.Integer,
                  sa.ForeignKey("items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_id", sa.Integer,
                  sa.ForeignKey("items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.UniqueConstraint("source_id", "target_id", "relation", name="uq_item_link"),
    )
    op.create_index("ix_item_links_source_id", "item_links", ["source_id"])
    op.create_index("ix_item_links_target_id", "item_links", ["target_id"])


def downgrade() -> None:
    op.drop_table("item_links")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_item_link_model.py -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Verify the migration applies against Postgres**

Run: `docker compose exec -T backend alembic upgrade head`
Expected: `Running upgrade 0005 -> 0006, item dependency links` (or "already at head" if re-run after a rebuild).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/alembic/versions/0006_item_links.py backend/tests/test_item_link_model.py
git commit -m "feat(backend): item_links table and model"
```

---

### Task 3: Link schemas + `links` router

**Files:**
- Modify: `backend/app/schemas.py` (add link schemas; add `links` to `ItemDetail`)
- Create: `backend/app/routers/links.py`
- Modify: `backend/app/main.py` (register the router)
- Test: `backend/tests/test_api_links.py`

**Interfaces:**
- Consumes: `RELATIONS`, `canonicalize` (Task 1); `ItemLink`, `Item` (Task 2).
- Produces:
  - Schemas `LinkCreate{source_id,target_id,relation}`, `ItemRef`, `LinkedItem`, `RelationOption`, `LinkRow`; `ItemDetail.links: list[LinkedItem]`.
  - Endpoints: `GET /api/link-relations`, `GET /api/links`, `POST /api/links` (201), `DELETE /api/links/{link_id}` (204).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api_links.py`:

```python
from app.models import Item, ItemKind


def _item(db, kind=ItemKind.FEATURE, title="X"):
    it = Item(kind=kind, title=title)
    db.add(it)
    db.commit()
    db.refresh(it)
    return it


def test_link_relations_lists_directed_options(client):
    opts = client.get("/api/link-relations").json()
    assert {"relation": "blocks", "direction": "incoming", "label": "blocked by"} in opts


def test_create_and_list_link(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, ItemKind.STORY, title="B")
    resp = client.post("/api/links", json={"source_id": a.id, "target_id": b.id, "relation": "blocks"})
    assert resp.status_code == 201
    rows = client.get("/api/links").json()
    assert len(rows) == 1
    assert rows[0]["source_id"] == a.id and rows[0]["target_id"] == b.id


def test_cross_kind_link_allowed(client, db_session):
    risk = _item(db_session, ItemKind.RISK, title="R")
    feat = _item(db_session, ItemKind.FEATURE, title="F")
    resp = client.post("/api/links", json={"source_id": risk.id, "target_id": feat.id, "relation": "blocks"})
    assert resp.status_code == 201


def test_self_link_rejected(client, db_session):
    a = _item(db_session, title="A")
    resp = client.post("/api/links", json={"source_id": a.id, "target_id": a.id, "relation": "blocks"})
    assert resp.status_code == 422


def test_unknown_relation_rejected(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    resp = client.post("/api/links", json={"source_id": a.id, "target_id": b.id, "relation": "nope"})
    assert resp.status_code == 422


def test_missing_endpoint_rejected(client, db_session):
    a = _item(db_session, title="A")
    resp = client.post("/api/links", json={"source_id": a.id, "target_id": 9999, "relation": "blocks"})
    assert resp.status_code == 422


def test_duplicate_rejected(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    body = {"source_id": a.id, "target_id": b.id, "relation": "blocks"}
    assert client.post("/api/links", json=body).status_code == 201
    assert client.post("/api/links", json=body).status_code == 409


def test_symmetric_relation_canonicalized_and_deduped(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    low, high = sorted([a.id, b.id])
    # created "backwards" -> stored canonical (low as source)
    first = client.post("/api/links", json={"source_id": high, "target_id": low, "relation": "relates_to"})
    assert first.status_code == 201
    assert first.json()["source_id"] == low and first.json()["target_id"] == high
    # the forward direction is now a duplicate
    dup = client.post("/api/links", json={"source_id": low, "target_id": high, "relation": "relates_to"})
    assert dup.status_code == 409


def test_delete_link(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    link_id = client.post("/api/links", json={"source_id": a.id, "target_id": b.id, "relation": "blocks"}).json()["id"]
    assert client.delete(f"/api/links/{link_id}").status_code == 204
    assert client.get("/api/links").json() == []
    assert client.delete(f"/api/links/{link_id}").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_links.py -q`
Expected: FAIL — 404s on `/api/links` (router not registered).

- [ ] **Step 3: Write the schemas**

In `backend/app/schemas.py`, add these classes (anywhere after `ItemBase`; `ItemKind` and `ConfigDict` are already imported):

```python
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
```

Then add the `links` field to `ItemDetail` (which currently declares only `children`):

```python
class ItemDetail(ItemRead):
    children: list[ItemRead] = []
    links: list[LinkedItem] = []
```

- [ ] **Step 4: Write the router**

Create `backend/app/routers/links.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.links import RELATIONS, canonicalize, relation_options
from app.models import Item, ItemLink
from app.schemas import LinkCreate, LinkRow, RelationOption

router = APIRouter(prefix="/api", tags=["links"])


@router.get("/link-relations", response_model=list[RelationOption])
def list_relations() -> list[dict[str, str]]:
    return relation_options()


@router.get("/links", response_model=list[LinkRow])
def list_links(db: Session = Depends(get_db)) -> list[ItemLink]:
    return list(db.scalars(select(ItemLink)))


@router.post("/links", response_model=LinkRow, status_code=201)
def create_link(payload: LinkCreate, db: Session = Depends(get_db)) -> ItemLink:
    if payload.relation not in RELATIONS:
        raise HTTPException(status_code=422, detail=f"Unknown relation '{payload.relation}'")
    if payload.source_id == payload.target_id:
        raise HTTPException(status_code=422, detail="An item cannot depend on itself")
    if db.get(Item, payload.source_id) is None or db.get(Item, payload.target_id) is None:
        raise HTTPException(status_code=422, detail="source_id or target_id does not exist")

    source_id, target_id = canonicalize(payload.source_id, payload.target_id, payload.relation)
    duplicate = db.scalar(
        select(ItemLink).where(
            ItemLink.source_id == source_id,
            ItemLink.target_id == target_id,
            ItemLink.relation == payload.relation,
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="Link already exists")

    link = ItemLink(source_id=source_id, target_id=target_id, relation=payload.relation)
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.delete("/links/{link_id}", status_code=204)
def delete_link(link_id: int, db: Session = Depends(get_db)) -> None:
    link = db.get(ItemLink, link_id)
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
```

Register it in `backend/app/main.py` — change the import line and add an `include_router`:

```python
from app.routers import imports, items, boards, teams, team_members, capacities, links

app.include_router(imports.router)
app.include_router(items.router)
app.include_router(boards.router)
app.include_router(teams.router)
app.include_router(team_members.router)
app.include_router(capacities.router)
app.include_router(links.router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_links.py -q`
Expected: PASS (9 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/links.py backend/app/main.py backend/tests/test_api_links.py
git commit -m "feat(backend): link CRUD endpoints and relation registry API"
```

---

### Task 4: Resolve `ItemDetail.links` + delete cleanup

**Files:**
- Modify: `backend/app/routers/items.py`
- Test: `backend/tests/test_api_links.py` (append)

**Interfaces:**
- Consumes: `ItemLink`, `RELATIONS`, `LinkedItem`, `ItemRef`, `ItemDetail`.
- Produces: `GET /api/items/{id}` returns `links` from this item's perspective; `DELETE /api/items/{id}` removes the item's links (and its child stories' links).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_api_links.py`:

```python
def test_detail_shows_link_from_both_ends(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, ItemKind.STORY, title="B")
    client.post("/api/links", json={"source_id": a.id, "target_id": b.id, "relation": "blocks"})

    a_detail = client.get(f"/api/items/{a.id}").json()
    assert len(a_detail["links"]) == 1
    assert a_detail["links"][0]["direction"] == "outgoing"
    assert a_detail["links"][0]["label"] == "blocks"
    assert a_detail["links"][0]["item"]["id"] == b.id

    b_detail = client.get(f"/api/items/{b.id}").json()
    assert b_detail["links"][0]["direction"] == "incoming"
    assert b_detail["links"][0]["label"] == "blocked by"
    assert b_detail["links"][0]["item"]["id"] == a.id


def test_symmetric_link_labels_both_ends(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    client.post("/api/links", json={"source_id": a.id, "target_id": b.id, "relation": "relates_to"})
    a_detail = client.get(f"/api/items/{a.id}").json()
    b_detail = client.get(f"/api/items/{b.id}").json()
    assert a_detail["links"][0]["label"] == "relates to"
    assert b_detail["links"][0]["label"] == "relates to"


def test_deleting_item_removes_its_links(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    client.post("/api/links", json={"source_id": a.id, "target_id": b.id, "relation": "blocks"})
    assert client.delete(f"/api/items/{a.id}").status_code == 204
    assert client.get("/api/links").json() == []


def test_deleting_parent_removes_child_story_links(client, db_session):
    feature = _item(db_session, ItemKind.FEATURE, title="F")
    other = _item(db_session, ItemKind.FEATURE, title="Other")
    story = Item(kind=ItemKind.STORY, title="S", parent_id=feature.id)
    db_session.add(story)
    db_session.commit()
    db_session.refresh(story)
    client.post("/api/links", json={"source_id": story.id, "target_id": other.id, "relation": "blocks"})
    assert client.delete(f"/api/items/{feature.id}").status_code == 204
    assert client.get("/api/links").json() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_links.py -q`
Expected: FAIL — `test_detail_shows_link_from_both_ends` gets `links == []`; the delete tests still show a leftover link.

- [ ] **Step 3: Write the implementation**

In `backend/app/routers/items.py`, update the imports:

```python
from sqlalchemy import delete, select

from app.db import get_db
from app.links import RELATIONS
from app.models import Item, ItemKind, ItemLink
from app.schemas import ItemCreate, ItemDetail, ItemRead, ItemUpdate, ItemRef, LinkedItem
```

Add a resolver helper (below `_get_or_404`):

```python
def _resolve_links(db: Session, item_id: int) -> list[LinkedItem]:
    edges = db.scalars(
        select(ItemLink).where(
            (ItemLink.source_id == item_id) | (ItemLink.target_id == item_id)
        )
    )
    out: list[LinkedItem] = []
    for edge in edges:
        rel = RELATIONS.get(edge.relation)
        if rel is None:  # unknown/legacy relation key — skip defensively
            continue
        if edge.source_id == item_id:
            other = db.get(Item, edge.target_id)
            direction, label = "outgoing", rel.forward
        else:
            other = db.get(Item, edge.source_id)
            direction, label = "incoming", rel.inverse
        out.append(
            LinkedItem(
                link_id=edge.id,
                relation=edge.relation,
                direction=direction,
                label=label,
                item=ItemRef.model_validate(other),
            )
        )
    out.sort(key=lambda link: (link.relation, link.direction, link.item.title))
    return out
```

Replace `get_item` so it returns a fully-built `ItemDetail` including links:

```python
@router.get("/{item_id}", response_model=ItemDetail)
def get_item(item_id: int, db: Session = Depends(get_db)) -> ItemDetail:
    item = _get_or_404(db, item_id)
    detail = ItemDetail.model_validate(item)
    detail.links = _resolve_links(db, item_id)
    return detail
```

Replace `delete_item` so it clears links for the item and its child stories first:

```python
@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)) -> None:
    item = _get_or_404(db, item_id)
    ids = [item_id, *[child.id for child in item.children]]
    db.execute(
        delete(ItemLink).where(
            ItemLink.source_id.in_(ids) | ItemLink.target_id.in_(ids)
        )
    )
    db.delete(item)  # ORM cascade removes child stories
    db.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_links.py tests/test_api_items.py -q`
Expected: PASS (all link + item tests green — the added detail/delete tests plus the pre-existing item tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/items.py backend/tests/test_api_links.py
git commit -m "feat(backend): resolve item links on detail and clean up on delete"
```

---

### Task 5: Frontend types + API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts` (append)

**Interfaces:**
- Produces:
  - Types `ItemRef`, `LinkedItem`, `RelationOption`, `LinkRow`; `Item.links?`; `BoardCard.blocked_by_count?`, `BoardCard.blocks_count?`.
  - Client fns `getLinkRelations()`, `listLinks()`, `createLink(body)`, `deleteLink(id)`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/api/client.test.ts` (extend the existing import from `./client` to include `createLink, deleteLink, listLinks`):

```ts
import { createLink, deleteLink, listLinks } from "./client";

it("createLink posts the edge body", async () => {
  const spy = mockFetch(201, { id: 1, source_id: 2, target_id: 3, relation: "blocks" });
  await createLink({ source_id: 2, target_id: 3, relation: "blocks" });
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe("/api/links");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(init?.body as string)).toEqual({ source_id: 2, target_id: 3, relation: "blocks" });
});

it("deleteLink sends DELETE", async () => {
  const spy = mockFetch(204, "");
  await deleteLink(7);
  expect(spy.mock.calls[0][0]).toBe("/api/links/7");
  expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
});

it("listLinks fetches all edges", async () => {
  mockFetch(200, [{ id: 1, source_id: 2, target_id: 3, relation: "blocks" }]);
  const rows = await listLinks();
  expect(rows).toHaveLength(1);
});
```

> Note: put the new `import` at the top of the file beside the existing `./client` import (or merge into it); the `it(...)` blocks go inside the existing `describe("api client", ...)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: FAIL — `createLink`/`deleteLink`/`listLinks` are not exported.

- [ ] **Step 3: Write the implementation**

In `frontend/src/types.ts`, add after the `BoardColumn` interface:

```ts
export interface ItemRef {
  id: number;
  title: string;
  kind: ItemKind;
  status: string | null;
  planning_interval: string | null;
}

export interface LinkedItem {
  link_id: number;
  relation: string;
  direction: "outgoing" | "incoming";
  label: string;
  item: ItemRef;
}

export interface RelationOption {
  relation: string;
  direction: "outgoing" | "incoming" | "both";
  label: string;
}

export interface LinkRow {
  id: number;
  source_id: number;
  target_id: number;
  relation: string;
}
```

Add `links` to the `Item` interface (next to `children?: Item[];`):

```ts
  children?: Item[];
  links?: LinkedItem[];
```

Add the two counts to `BoardCard` (optional, so existing card fixtures keep compiling):

```ts
export interface BoardCard extends Item {
  children_count: number;
  children_points: number;
  blocked_by_count?: number;
  blocks_count?: number;
}
```

In `frontend/src/api/client.ts`, extend the type import to include the new types:

```ts
import type {
  Board,
  Capacity,
  ImportResult,
  Item,
  ItemCreate,
  ItemUpdate,
  Lane,
  LinkRow,
  RelationOption,
  Team,
  TeamMember,
} from "../types";
```

Add the four functions (e.g. after `deleteItem`):

```ts
export function getLinkRelations(): Promise<RelationOption[]> {
  return request<RelationOption[]>("/api/link-relations");
}

export function listLinks(): Promise<LinkRow[]> {
  return request<LinkRow[]>("/api/links");
}

export function createLink(body: {
  source_id: number;
  target_id: number;
  relation: string;
}): Promise<LinkRow> {
  return request<LinkRow>("/api/links", json(body));
}

export function deleteLink(linkId: number): Promise<void> {
  return request<void>(`/api/links/${linkId}`, { method: "DELETE" });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/api/client.test.ts && npx tsc --noEmit`
Expected: PASS and a clean type-check.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(frontend): types and API client for item links"
```

---

### Task 6: Board card blocked-by badges

**Files:**
- Modify: `frontend/src/lib/boardLanes.ts` (`buildBoardCards` gains a `links` param)
- Modify: `frontend/src/lib/groupByStatus.ts` (`toCard` defaults the two counts)
- Modify: `frontend/src/hooks/useBoard.ts` (fetch links)
- Modify: `frontend/src/App.tsx` (pass `links` to `BoardView`)
- Modify: `frontend/src/components/BoardView.tsx` (accept `links`, forward to `buildBoardCards`)
- Modify: `frontend/src/components/Card.tsx` (render badge)
- Test: `frontend/src/lib/boardLanes.test.ts` (append), `frontend/src/components/Card.test.tsx` (append)

**Interfaces:**
- Consumes: `LinkRow` type, `listLinks()` (Task 5).
- Produces: `buildBoardCards(items: Item[], links?: LinkRow[]): BoardCard[]` with `blocked_by_count` / `blocks_count`; `useBoard()` returns `links: LinkRow[]`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/boardLanes.test.ts` (import `buildBoardCards` if not already imported, and `LinkRow` type as needed):

```ts
it("buildBoardCards counts blocks/blocked_by from links", () => {
  const items = [
    { id: 1, kind: "feature", title: "A", parent_id: null } as never,
    { id: 2, kind: "story", title: "B", parent_id: null } as never,
  ];
  const links = [{ id: 10, source_id: 1, target_id: 2, relation: "blocks" }];
  const cards = buildBoardCards(items, links);
  const a = cards.find((c) => c.id === 1)!;
  const b = cards.find((c) => c.id === 2)!;
  expect(a.blocks_count).toBe(1);
  expect(a.blocked_by_count).toBe(0);
  expect(b.blocked_by_count).toBe(1);
  expect(b.blocks_count).toBe(0);
});

it("buildBoardCards ignores non-blocks relations for counts", () => {
  const items = [{ id: 1, kind: "feature", title: "A", parent_id: null } as never];
  const cards = buildBoardCards(items, [{ id: 1, source_id: 1, target_id: 1, relation: "relates_to" }]);
  expect(cards[0].blocks_count).toBe(0);
  expect(cards[0].blocked_by_count).toBe(0);
});
```

Append to `frontend/src/components/Card.test.tsx` (reuse the file's existing `card` fixture-building pattern; construct a card with the counts):

```ts
it("shows a blocked-by badge when blocked_by_count > 0", () => {
  const card = { id: 1, kind: "story", title: "S", type: null, status: "New",
    parent_id: null, position: 0, wsjf_score: null, children_count: 0, children_points: 0,
    blocked_by_count: 2, blocks_count: 0 } as never;
  render(<Card card={card} onOpen={() => {}} />);
  expect(screen.getByText(/blocked by 2/i)).toBeInTheDocument();
});

it("hides the blocked-by badge when count is 0", () => {
  const card = { id: 1, kind: "story", title: "S", type: null, status: "New",
    parent_id: null, position: 0, wsjf_score: null, children_count: 0, children_points: 0,
    blocked_by_count: 0, blocks_count: 0 } as never;
  render(<Card card={card} onOpen={() => {}} />);
  expect(screen.queryByText(/blocked by/i)).not.toBeInTheDocument();
});
```

> If `Card.test.tsx` lacks `render`/`screen`/`Card` imports at the top, add: `import { render, screen } from "@testing-library/react";` and `import Card from "./Card";`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/boardLanes.test.ts src/components/Card.test.tsx`
Expected: FAIL — `buildBoardCards` takes one arg / counts undefined; Card renders no badge.

- [ ] **Step 3: Update `buildBoardCards`**

In `frontend/src/lib/boardLanes.ts`, change the import line to include `LinkRow`:

```ts
import type { BoardCard, BoardColumn, Item, LinkRow } from "../types";
```

Replace `buildBoardCards` with:

```ts
/** Map items to BoardCards, computing per-feature child aggregates and
 *  blocks/blocked-by counts (from `blocks` links) client-side. */
export function buildBoardCards(items: Item[], links: LinkRow[] = []): BoardCard[] {
  const childrenByParent = new Map<number, Item[]>();
  for (const it of items) {
    if (it.parent_id != null) {
      const arr = childrenByParent.get(it.parent_id) ?? [];
      arr.push(it);
      childrenByParent.set(it.parent_id, arr);
    }
  }

  const blocksCount = new Map<number, number>();
  const blockedByCount = new Map<number, number>();
  for (const link of links) {
    if (link.relation !== "blocks") continue;
    blocksCount.set(link.source_id, (blocksCount.get(link.source_id) ?? 0) + 1);
    blockedByCount.set(link.target_id, (blockedByCount.get(link.target_id) ?? 0) + 1);
  }

  return items.map((it) => {
    const kids = childrenByParent.get(it.id) ?? [];
    return {
      ...it,
      children_count: kids.length,
      children_points: kids.reduce((sum, c) => sum + (c.story_points ?? 0), 0),
      blocked_by_count: blockedByCount.get(it.id) ?? 0,
      blocks_count: blocksCount.get(it.id) ?? 0,
    };
  });
}
```

In `frontend/src/lib/groupByStatus.ts`, update `toCard`:

```ts
function toCard(item: Item): BoardCard {
  return { ...item, children_count: 0, children_points: 0, blocked_by_count: 0, blocks_count: 0 };
}
```

- [ ] **Step 4: Wire links through the board**

In `frontend/src/hooks/useBoard.ts`:

```ts
import { getBoards, listItems, listLinks } from "../api/client";
import type { Board, Item, LinkRow } from "../types";
```

Add a `links` state and include it in the parallel fetch:

```ts
  const [links, setLinks] = useState<LinkRow[]>([]);
```

```ts
      const [b, its, lks] = await Promise.all([getBoards(), listItems(), listLinks()]);
      setBoards(b);
      setItems(its);
      setLinks(lks);
      setError(null);
```

And return it:

```ts
  return { boards, items, links, loading, error, reload };
```

In `frontend/src/App.tsx`, destructure `links` and pass it to `BoardView`:

```ts
  const { boards, items, links, loading, error, reload } = useBoard();
```

```tsx
          <BoardView
            board={activeBoard}
            items={items}
            links={links}
            filters={filters}
            onOpenCard={openItem}
            onOpenStories={setOpenStoriesFeatureId}
            onChanged={handleChanged}
          />
```

In `frontend/src/components/BoardView.tsx`, add `links` to the type import and props, and pass it into `buildBoardCards`:

```ts
import type { Board, BoardCard, Item, LinkRow } from "../types";
```

Add `links` to the component's destructured props (alongside `items`), typed `links: LinkRow[];`, then:

```ts
  const columns = useMemo(() => {
    const cards = buildBoardCards(items, links);
    return groupIntoLanes(visible(cards, board, filters), board.lanes);
  }, [items, links, board, filters]);
```

- [ ] **Step 5: Render the badge in `Card.tsx`**

In `frontend/src/components/Card.tsx`, inside the `<div className="mt-2 flex flex-wrap ...">` chip row (after the existing chips, before the closing `</div>`):

```tsx
          {(card.blocked_by_count ?? 0) > 0 && (
            <span className="font-medium text-red-600">
              ⛔ blocked by {card.blocked_by_count}
            </span>
          )}
          {(card.blocks_count ?? 0) > 0 && <span>blocks {card.blocks_count}</span>}
```

- [ ] **Step 6: Run tests + type-check to verify they pass**

Run: `cd frontend && npx vitest run src/lib/boardLanes.test.ts src/components/Card.test.tsx && npx tsc --noEmit`
Expected: PASS and clean type-check.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/boardLanes.ts frontend/src/lib/groupByStatus.ts frontend/src/hooks/useBoard.ts frontend/src/App.tsx frontend/src/components/BoardView.tsx frontend/src/components/Card.tsx frontend/src/lib/boardLanes.test.ts frontend/src/components/Card.test.tsx
git commit -m "feat(frontend): blocked-by badges on board cards"
```

---

### Task 7: Dependencies section in the item drawer

**Files:**
- Modify: `frontend/src/components/ItemDrawer.tsx`
- Modify: `frontend/src/App.tsx` (pass `onOpenItem` to drawers)
- Test: `frontend/src/components/ItemDrawerLinks.test.tsx` (new)

**Interfaces:**
- Consumes: `getLinkRelations`, `listItems`, `createLink`, `deleteLink`, `getItem` (returns `Item` with `links`); `ItemDrawer` gains prop `onOpenItem?: (id: number) => void`.
- Produces: drawer UI to view/add/remove links.

Note: `onOpenItem` is a **new** prop used only by the dependency rows; the existing `onOpenParent`/`onOpenChild` props and behavior are unchanged (avoids reworking the parent/child panel semantics). In `App.tsx`, `onOpenItem` docks the linked item to the left of the current stack.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ItemDrawerLinks.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const base = {
  id: 5, kind: "feature", type: null, title: "A", status: "New", wsjf_score: null,
  business_value: null, time_criticality: null, risk_reduction: null, cost_of_delay: null,
  job_size: null, parent_id: null, position: 0, description: null, planning_interval: null,
  iteration: null, leading_team: null, story_points: null, tshirt_size: null, kategorie: null,
  art: null, sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null, definition_of_done: null,
  children: [],
};

const relations = [
  { relation: "blocks", direction: "outgoing", label: "blocks" },
  { relation: "blocks", direction: "incoming", label: "blocked by" },
  { relation: "relates_to", direction: "both", label: "relates to" },
];

beforeEach(() => {
  vi.spyOn(client, "getLinkRelations").mockResolvedValue(relations as never);
  vi.spyOn(client, "listItems").mockResolvedValue([
    { ...base, id: 9, title: "Other" },
  ] as never);
});

it("renders existing links grouped by label and deletes on ×", async () => {
  const item = {
    ...base,
    links: [{ link_id: 1, relation: "blocks", direction: "incoming", label: "blocked by",
      item: { id: 9, title: "Other", kind: "story", status: null, planning_interval: null } }],
  };
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const del = vi.spyOn(client, "deleteLink").mockResolvedValue(undefined as never);

  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);
  expect(await screen.findByText("blocked by")).toBeInTheDocument();
  expect(screen.getByText("Other")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /remove link 1/i }));
  expect(del).toHaveBeenCalledWith(1);
});

it("opens the linked item on row click", async () => {
  const item = {
    ...base,
    links: [{ link_id: 1, relation: "blocks", direction: "incoming", label: "blocked by",
      item: { id: 9, title: "Other", kind: "story", status: null, planning_interval: null } }],
  };
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const onOpenItem = vi.fn();
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} onOpenItem={onOpenItem} />);
  await userEvent.click(await screen.findByRole("button", { name: /Other/ }));
  expect(onOpenItem).toHaveBeenCalledWith(9);
});

it("adds an outgoing 'blocks' link with current item as source", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...base, links: [] } as never);
  const create = vi.spyOn(client, "createLink").mockResolvedValue({ id: 2 } as never);

  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);
  // choose relation "blocks", then pick the target item "Other (#9)"
  await userEvent.click(await screen.findByRole("button", { name: /add dependency/i }));
  await userEvent.click(screen.getByRole("option", { name: "blocks" }));
  await userEvent.click(screen.getByRole("button", { name: /choose item/i }));
  await userEvent.click(screen.getByText("Other (#9)"));

  expect(create).toHaveBeenCalledWith({ source_id: 5, target_id: 9, relation: "blocks" });
});

it("adds an incoming 'blocked by' link with current item as target", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...base, links: [] } as never);
  const create = vi.spyOn(client, "createLink").mockResolvedValue({ id: 3 } as never);

  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /add dependency/i }));
  await userEvent.click(screen.getByRole("option", { name: "blocked by" }));
  await userEvent.click(screen.getByRole("button", { name: /choose item/i }));
  await userEvent.click(screen.getByText("Other (#9)"));

  expect(create).toHaveBeenCalledWith({ source_id: 9, target_id: 5, relation: "blocks" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ItemDrawerLinks.test.tsx`
Expected: FAIL — no Dependencies UI / `onOpenItem` prop.

- [ ] **Step 3: Implement the Dependencies section**

In `frontend/src/components/ItemDrawer.tsx`:

Update imports and the component signature to add the client fns and the new prop:

```ts
import { createItem, createLink, deleteItem, deleteLink, getItem, getLinkRelations, listItems, updateItem } from "../api/client";
import type { Item, ItemUpdate, RelationOption } from "../types";
```

Add `onOpenItem` to the props destructure and its type:

```ts
  onOpenParent,
  onOpenChild,
  onOpenItem,
```

```ts
  onOpenParent?: (parentId: number) => void;
  onOpenChild?: (storyId: number) => void;
  onOpenItem?: (id: number) => void;
```

Add state + effects near the other hooks (after `const [error, setError] = useState...`):

```ts
  const [relations, setRelations] = useState<RelationOption[]>([]);
  const [candidates, setCandidates] = useState<Item[]>([]);
  const [adding, setAdding] = useState(false);
  const [pickRelation, setPickRelation] = useState<RelationOption | null>(null);
  const [pickOpen, setPickOpen] = useState(false);

  useEffect(() => {
    void getLinkRelations().then(setRelations);
    void listItems().then(setCandidates);
  }, []);
```

Add link mutation handlers (near `reloadItem`):

```ts
  const addLink = async (relation: RelationOption, otherId: number) => {
    const body =
      relation.direction === "incoming"
        ? { source_id: otherId, target_id: itemId, relation: relation.relation }
        : { source_id: itemId, target_id: otherId, relation: relation.relation };
    try {
      await createLink(body);
      setAdding(false);
      setPickRelation(null);
      await reloadItem();
    } catch (e) {
      setError(String(e));
    }
  };

  const removeLink = async (linkId: number) => {
    await deleteLink(linkId);
    await reloadItem();
  };
```

Render the Dependencies section — place this block just before the final actions `<div className="mt-6 flex gap-2">`:

```tsx
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Dependencies</h3>
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
          >
            {adding ? "Cancel" : "+ Add dependency"}
          </button>
        </div>

        <ul className="flex flex-col gap-1">
          {(item.links ?? []).map((link) => (
            <li
              key={link.link_id}
              className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm"
            >
              <button
                onClick={() => onOpenItem?.(link.item.id)}
                className="min-w-0 flex-1 truncate text-left"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {link.label}
                </span>{" "}
                <span className="text-blue-700 hover:underline">{link.item.title}</span>
                <span className="ml-1 text-xs text-gray-400">({link.item.kind})</span>
              </button>
              <button
                aria-label={`remove link ${link.link_id}`}
                onClick={() => removeLink(link.link_id)}
                className="ml-2 shrink-0 text-gray-400 hover:text-red-600"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        {adding && (
          <div className="mt-2 flex flex-col gap-2 rounded border border-gray-200 p-2">
            <div className="relative">
              <button
                type="button"
                aria-haspopup="listbox"
                onClick={() => setPickOpen((o) => !o)}
                className="w-full rounded border border-gray-200 px-2 py-1 text-left text-sm"
              >
                {pickRelation ? pickRelation.label : "Choose relation…"}
              </button>
              {pickOpen && (
                <ul role="listbox" className="absolute z-20 mt-1 w-full rounded border border-gray-200 bg-white p-1 shadow">
                  {relations.map((rel) => (
                    <li key={`${rel.relation}-${rel.direction}`}>
                      <button
                        role="option"
                        aria-selected={pickRelation?.label === rel.label}
                        onClick={() => {
                          setPickRelation(rel);
                          setPickOpen(false);
                        }}
                        className="w-full rounded px-2 py-1 text-left text-sm hover:bg-gray-50"
                      >
                        {rel.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <ItemPicker
              disabled={!pickRelation}
              items={candidates.filter((c) => c.id !== itemId)}
              onPick={(otherId) => pickRelation && void addLink(pickRelation, otherId)}
            />
          </div>
        )}
      </div>
```

Add a small `ItemPicker` helper component at the bottom of the file (after the `Drawer` function):

```tsx
function ItemPicker({
  items,
  disabled,
  onPick,
}: {
  items: Item[];
  disabled: boolean;
  onPick: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const label = (it: Item) => `${it.title} (#${it.id})`;
  const filtered = items.filter((it) => label(it).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="choose item"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded border border-gray-200 px-2 py-1 text-left text-sm disabled:opacity-50"
      >
        Choose item…
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded border border-gray-200 bg-white p-1 shadow">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="mb-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
          />
          <ul className="max-h-48 overflow-auto">
            {filtered.map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => {
                    onPick(it.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-gray-50"
                >
                  {label(it)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

In `frontend/src/App.tsx`, add an `onOpenItem` handler and pass it to the drawers. Add near the other panel handlers:

```ts
  const openItemDocked = (id: number) =>
    setPanels((p) => (p.includes(id) ? p : [id, ...p]));
```

Pass it to `ItemDrawer` in the panels map:

```tsx
              onOpenParent={openParent}
              onOpenChild={openChild}
              onOpenItem={openItemDocked}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ItemDrawerLinks.test.tsx && npx tsc --noEmit`
Expected: PASS and clean type-check.

- [ ] **Step 5: Run the full frontend suite (guard against regressions)**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all suites PASS, clean type-check.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ItemDrawer.tsx frontend/src/App.tsx frontend/src/components/ItemDrawerLinks.test.tsx
git commit -m "feat(frontend): add/remove/view dependency links in item drawer"
```

---

### Task 8: Rebuild the stack and smoke-test

**Files:** none (verification only).

- [ ] **Step 1: Rebuild and restart**

Run: `docker compose up -d --build`
Expected: `frontend`, `backend`, `db` all up; backend healthy.

- [ ] **Step 2: Confirm the migration is applied**

Run: `docker compose exec -T backend alembic current`
Expected: shows `0006`.

- [ ] **Step 3: Smoke-test the API**

Run:
```bash
curl -s localhost:8000/api/link-relations
```
Expected: JSON array containing `{"relation":"blocks","direction":"incoming","label":"blocked by"}`.

- [ ] **Step 4: Manual UI check**

Open http://localhost:8080, open an item drawer, add a "blocked by" dependency to another item, confirm it appears grouped under "blocked by", the linked item opens on click, the board card shows the "⛔ blocked by 1" badge after a reload, and the × removes the link.

---

## Self-Review Notes

- **Spec coverage:** item_links table + registry (T1–T2); link CRUD, relations & list endpoints, validation incl. self/duplicate/unknown/missing + symmetric canonicalization (T3); detail resolution with both-end labels + explicit delete cleanup incl. child stories (T4); FE types/client (T5); client-side badge counts + wiring (T6); drawer add/remove/view + click-to-open (T7); free-text `dependencies` field untouched throughout; CSV import untouched (no task changes it). Rebuild/smoke (T8).
- **Deviation from spec (deliberate):** `onOpenItem` is added as a *new* drawer prop rather than folding `onOpenParent`/`onOpenChild` into it — this preserves existing parent/child panel behavior and their tests. `BoardCard` counts are optional (not required) so existing card fixtures compile unchanged.
- **Scope guards honored:** no graph view, no cycle enforcement, no CSV auto-resolution, only `blocks`/`relates_to` relations.
