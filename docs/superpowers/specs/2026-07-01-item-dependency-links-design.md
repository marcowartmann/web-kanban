# Item Dependency Links — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending spec review

## Goal

Let users connect **any two items** (feature, story, or risk — across the
hierarchy) with an explicit, **directed, typed** dependency link, replacing the
current free-text `dependencies` blob as the *structured* way to express
relationships. An item can have **many** links in either direction (one-to-many
both ways). The link model is **flexible and expandable**: `blocks` /
`blocked by` today, room for more relation types later **without a schema
migration**.

## Domain model

A link is a **directed edge** between two items with a `relation` key:

- `source_id --relation--> target_id`
- Directional relations read differently from each end. For `blocks`:
  the source **blocks** the target; the target is **blocked by** the source.
- Some relations are **symmetric** (e.g. `relates_to`): both ends read the same.

Relation types live in an **app-level registry**, not a DB enum, so adding one
is a one-line change:

```python
# app/links.py
@dataclass(frozen=True)
class Relation:
    forward: str    # label shown on the source end
    inverse: str    # label shown on the target end
    symmetric: bool

RELATIONS: dict[str, Relation] = {
    "blocks":     Relation(forward="blocks",     inverse="blocked by", symmetric=False),
    "relates_to": Relation(forward="relates to", inverse="relates to", symmetric=True),
}
```

**Canonicalization.** For a symmetric relation the edge is stored once with
`source_id < target_id`, so `A↔B` never also exists as `B↔A`. Directional
relations are stored exactly as created.

Cross-kind links are unrestricted: any kind ↔ any kind, including a story and its
own parent feature. The free-text `dependencies` field is **kept untouched** and
shown as separate "Dependencies (notes)".

## Data model

New table **`item_links`** (one Alembic migration `0006_item_links`):

| column       | type          | notes                                   |
|--------------|---------------|-----------------------------------------|
| `id`         | INTEGER PK    |                                         |
| `source_id`  | FK→items      | `ON DELETE CASCADE`                     |
| `target_id`  | FK→items      | `ON DELETE CASCADE`                     |
| `relation`   | `String(32)`  | registry key                            |
| `created_at` | timestamp     | `server_default=func.now()`             |

- `UniqueConstraint(source_id, target_id, relation)` → `uq_item_link`.
- Indexes on `source_id` and `target_id` for reverse lookups.
- `source_id != target_id` enforced in the API layer (no self-links).

`models.py` `ItemLink`:

```python
class ItemLink(Base):
    __tablename__ = "item_links"
    __table_args__ = (
        UniqueConstraint("source_id", "target_id", "relation", name="uq_item_link"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    relation: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

The existing `Item.dependencies` Text column is unchanged.

## Backend

**`app/links.py`** — the `Relation` dataclass, the `RELATIONS` registry, plus
helpers:

- `relation_options()` → the directed picker options derived from the registry:
  `[{"relation": "blocks", "direction": "outgoing", "label": "blocks"},
    {"relation": "blocks", "direction": "incoming", "label": "blocked by"},
    {"relation": "relates_to", "direction": "both", "label": "relates to"}]`
- `canonicalize(source_id, target_id, relation)` → `(source_id, target_id)`,
  swapping the pair for symmetric relations so the smaller id is the source.

**`schemas.py`**

```python
class LinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: int
    target_id: int
    relation: str

class ItemRef(BaseModel):               # the "other" item on a link
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    kind: ItemKind
    status: str | None = None
    planning_interval: str | None = None

class LinkedItem(BaseModel):            # a link from THIS item's perspective
    link_id: int
    relation: str                      # "blocks"
    direction: str                     # "outgoing" | "incoming"
    label: str                         # "blocks" / "blocked by" / "relates to"
    item: ItemRef                      # the other endpoint

class RelationOption(BaseModel):
    relation: str
    direction: str                     # "outgoing" | "incoming" | "both"
    label: str

class LinkRow(BaseModel):               # flat edge, for the board to count
    model_config = ConfigDict(from_attributes=True)
    id: int
    source_id: int
    target_id: int
    relation: str
```

- `ItemDetail` gains `links: list[LinkedItem] = []`.

**`app/routers/links.py`** (`prefix="/api"`)

- `GET /api/link-relations` → `list[RelationOption]` from `relation_options()`.
- `GET /api/links` → `list[LinkRow]` (all edges). The board fetches this once to
  compute per-card counts client-side (see Frontend); avoids per-card queries.
- `POST /api/links` `LinkCreate` → 201, returns the created row. Validation:
  - both items exist → else 422;
  - `relation` in `RELATIONS` → else 422;
  - `source_id != target_id` → else 422 ("an item cannot depend on itself");
  - canonicalize, then reject an existing `(source, target, relation)` → 409.
- `DELETE /api/links/{link_id}` → 204 (404 if missing).

**`app/routers/items.py`**

- `get_item` builds `ItemDetail.links` by querying `ItemLink` where
  `source_id == id OR target_id == id`. For each edge, resolve the *other*
  endpoint and the display label:
  - edge where the item is `source` → `direction="outgoing"`, `label=forward`,
    `item=target` (for symmetric, still shows the single label).
  - edge where the item is `target` → `direction="incoming"`, `label=inverse`,
    `item=source`.
  - Sort deterministically (by `relation`, then `direction`, then other title).
- `delete_item` **explicitly deletes** the item's links (edges where it is source
  or target) before/with the item delete. This is DB-agnostic: prod Postgres
  would honor the FK `ON DELETE CASCADE`, but the SQLite test engine has FK
  enforcement off by default, so an explicit `DELETE FROM item_links` keeps
  behavior identical across both. (The FK cascade stays as defense-in-depth.)

**Board card counts** are *not* computed on the backend. The board is assembled
client-side from the flat items list (`lib/boardLanes.ts`), so counts are derived
there from the fetched `GET /api/links` list (see Frontend). The unused backend
`BoardCard`/`BoardColumn` schemas are left as-is (out of scope).

**`csv_import.py`** — unchanged. The "Dependencies" column keeps loading into the
free-text `dependencies` field; no structured links are created on import.

## Frontend

**Types (`types.ts`)**

```ts
export interface ItemRef {
  id: number; title: string; kind: ItemKind;
  status: string | null; planning_interval: string | null;
}
export interface LinkedItem {
  link_id: number; relation: string;
  direction: "outgoing" | "incoming"; label: string; item: ItemRef;
}
export interface RelationOption {
  relation: string; direction: "outgoing" | "incoming" | "both"; label: string;
}
export interface LinkRow {
  id: number; source_id: number; target_id: number; relation: string;
}
```
- `Item` (detail) gains `links?: LinkedItem[]`.
- `BoardCard` (frontend-computed type) gains `blocked_by_count: number` and
  `blocks_count: number`.

**API client (`api/client.ts`)**

- `getLinkRelations(): Promise<RelationOption[]>`
- `listLinks(): Promise<LinkRow[]>`
- `createLink(body: {source_id; target_id; relation}): Promise<...>`
- `deleteLink(linkId: number): Promise<void>`
- The drawer picker reuses the existing `listItems({ q })` (there is no
  `getItems`).

**ItemDrawer (`ItemDrawer.tsx`)** — new **Dependencies** section below the fields:

- Links grouped by `label` ("Blocked by", "Blocks", "Relates to"). Each row shows
  the other item's title + a small kind chip, is **click-to-open** side-by-side,
  and has an `×` to `deleteLink` then reload.
- The existing parent/child open handlers (`onOpenParent`, `onOpenChild`) are
  generalized into a single **`onOpenItem(id)`** passed from the app; the parent
  link and story list reuse it. (Keeps one code path for the side-by-side stack.)
- **Add link** row: a relation-label dropdown fed by `getLinkRelations()` +
  a `SearchableSelect` over items (queried via `listItems({ q })`, excludes the
  current item). Choosing a relation option + target →
  compute the edge from `direction` (outgoing → `source=current,target=other`;
  incoming → `source=other,target=current`; both → either, backend canonicalizes)
  → `createLink` → reload.
- Free-text `dependencies` stays as its own labelled textarea ("Dependencies
  (notes)").

**Board wiring** — `useBoard` fetches links alongside items
(`Promise.all([getBoards(), listItems(), listLinks()])`). `buildBoardCards(items,
links)` computes each card's `blocked_by_count` (incoming `blocks` edges) and
`blocks_count` (outgoing `blocks` edges) from the links list, keyed by item id;
`groupByStatus.toCard` defaults both to `0`.

**Card (`Card.tsx`)** — a compact badge when counts are present, e.g.
`⛔ blocked by {blocked_by_count}` and/or `blocks {blocks_count}`, styled like the
existing chips. Hidden when both are zero.

## Error handling

- Self-link, unknown relation, missing item → 422; duplicate edge → 409. The
  drawer surfaces the message inline (same pattern as the current `error` state).
- Deleting an item cascades its links via the FK, so no dangling edges.
- A picker search that matches nothing → empty option list (no crash).

## Testing

**Backend** (`tests/test_api_links.py`, plus additions)

- `POST /api/links` creates a `blocks` edge; `GET /api/items/{target}` shows it as
  `label="blocked by"`, `direction="incoming"`; the source shows `label="blocks"`,
  `direction="outgoing"`.
- Cross-kind link (risk → feature) allowed.
- Self-link → 422; duplicate `(source,target,relation)` → 409; unknown relation →
  422; missing endpoint → 422.
- Symmetric `relates_to` is canonicalized: creating `B→A` stores `A→B`, and a
  second `A→B` is a duplicate (409). Both endpoints render `label="relates to"`.
- Deleting an item removes its links (cascade) — no orphan rows.
- `GET /api/link-relations` returns the expected directed options.
- `GET /api/links` returns all edges as flat `LinkRow`s.

**Frontend** (vitest)

- ItemDrawer renders links grouped by label, calls `createLink` with the correct
  `source_id`/`target_id` for both a "blocks" (outgoing) and a "blocked by"
  (incoming) selection, `deleteLink` on `×`, and `onOpenItem` on row click.
- `getLinkRelations` drives the relation dropdown options.
- `buildBoardCards(items, links)` computes `blocked_by_count` / `blocks_count`
  per card from the links list.
- Card shows the blocked-by badge when `blocked_by_count > 0` and hides it at 0.

## Scope guards (v1 — YAGNI)

- **No dedicated graph/network visualization** — drawer lists + card badges only.
- **No cycle enforcement.** Self-links and duplicates are blocked; a `blocks`
  cycle is *not* detected/rejected in v1 (noted as a future follow-up, along with
  Planning-view scheduling warnings).
- **No CSV auto-resolution** — the "Dependencies" column stays free text; links
  are created in the UI.
- **No new relation types beyond `blocks` and `relates_to`** shipped now; the
  registry is the seam for adding more later.
- The free-text `dependencies` field is retained, not migrated.
