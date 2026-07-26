# Product Roadmaps with Streams — Design

Date: 2026-07-26
Status: Approved design, pending implementation plan

## Context and goal

Sub-project 4 of 4 — the final piece of the product & service lifecycle
roadmap (sub-projects 1–3 are merged: catalog, components/systems lifecycle,
support contracts). This spec adds **product roadmaps**: per-product streams
(e.g. campus access / datacenter / backbone within the Network product)
holding time-ranged roadmap items that link strategy to existing Kanban
Features, rendered as a Gantt-style top-level Roadmap view.

## Decisions made during brainstorming

- **Model:** streams belong to a product; roadmap items belong to a stream,
  carry a free date range, and can link 0..n existing Features (no
  duplication of Features; roadmaps can also hold ideas that aren't Features
  yet).
- **Time axis:** free date ranges (`start_date`/`end_date`, both required,
  `start_date ≤ end_date` enforced), rendered on a month-gridded axis.
- **Status:** dedicated enum `idea | planned | committed | done | cancelled`
  (roadmap vocabulary, independent of feature statuses), default `idea`.
- **UI:** ONE surface — a new top-level Roadmap view with a product selector;
  no product-detail tab. Stream and item CRUD happen in the view.
- **No drag-and-drop of bars in this cut** — dates are edited in the item
  drawer. Recorded as a follow-up.
- **Feature-side links never block feature deletion** — deleting a Kanban
  feature silently drops the roadmap link (CASCADE), unlike the RESTRICT
  convention used for catalog tech links.
- **Architecture:** extends `backend/app/catalog/` (domain + ports + Postgres
  adapter + factory); ORM in `models.py`; migration `0029`; any signed-in
  user writes; field-level audit.

## 1. Domain model & data

Migration `0029`:

### streams
| column | type | notes |
|---|---|---|
| id | int PK | |
| name | str(128) not null | unique per product (DB constraint `(product_id, name)` named `uq_stream_product_name`) |
| product_id | FK → products.id, not null, ON DELETE RESTRICT | |
| position | int not null, default 0 | lane order |
| created_at / updated_at | datetime | server defaults, as elsewhere |

### roadmap_items
| column | type | notes |
|---|---|---|
| id | int PK | |
| title | str(256) not null | |
| description | text nullable | |
| stream_id | FK → streams.id, not null, ON DELETE RESTRICT | stream delete is guarded, not cascaded |
| status | enum RoadmapStatus, default `idea` | persisted lowercase via `values_callable`, VARCHAR(16) |
| start_date | date not null | |
| end_date | date not null | domain rule: `start_date ≤ end_date` → `CatalogRuleViolation` |
| created_at / updated_at | datetime | |

### roadmap_item_features
`roadmap_item_id` FK → roadmap_items (CASCADE), `feature_id` FK → items
(CASCADE — deleting a Feature drops the link silently); composite PK.
Linked target must be an item of kind `feature` (domain rule → 422).

### RoadmapStatus (in `catalog/domain.py`)
`idea | planned | committed | done | cancelled`.

### Deletion guards (409)
- Stream: blocked while it has roadmap items.
- Product: additionally blocked while it has streams.
- Roadmap item: deletable at any time (feature links removed explicitly for
  the SQLite fixtures, per the established pattern).

## 2. Ports & adapter (extends `backend/app/catalog/`)

- `domain.py`: enum `RoadmapStatus`; dataclasses
  `LinkedFeature(id, title, status)` (feature summary),
  `RoadmapItem(id, title, stream_id, description=None,
  status=RoadmapStatus.IDEA, start_date, end_date; read-side:
  features: list[LinkedFeature])`,
  `Stream(id, name, product_id, position=0; read-side:
  items: list[RoadmapItem])`; validator
  `validate_date_range(start_date, end_date)` →
  `CatalogRuleViolation("start_date must not be after end_date")`.
- `ports.py`:
  - `StreamRepository`: `list(product_id) -> list[Stream]` (position-ordered,
    items included, items date-ordered by start_date then id), `get`,
    `create(*, name, product_id)` (position = max+1), `update(stream_id,
    changes)` (name and/or position), `delete`.
  - `RoadmapItemRepository`: `get`, `create(*, title, stream_id,
    start_date, end_date, description=None, status=RoadmapStatus.IDEA)`,
    `update(item_id, changes)` (title/description/status/start_date/
    end_date/stream_id — moving between streams allowed, target stream must
    belong to the same product), `delete`,
    `link_feature(item_id, feature_id)` / `unlink_feature(item_id,
    feature_id)` (duplicate → 422 "This link already exists"; non-feature
    target → 422 "Only features can be linked"; missing link → 404
    "Link not found").
  - Date-range rule enforced on create AND update (using the effective
    post-change pair).
- Adapter + factory extended per the established pattern (flush-only,
  `read_only` seam, explicit link cleanup on item delete).

## 3. API surface

All under `require_user`; any signed-in user writes; audit
(`stream.created/updated/deleted`, `roadmap_item.created/updated/deleted`
field-level — dates as ISO strings, status values, stream move logged as
field "stream" with old/new stream NAMES —
`roadmap_item.feature_linked/unlinked` with field "feature" and the feature
title as value).

| Endpoint | Methods |
|---|---|
| `/api/v1/products/{id}/roadmap` | GET → `list[StreamRead]` (streams with nested items + linked-feature summaries) |
| `/api/v1/streams` | POST (201) |
| `/api/v1/streams/{id}` | PATCH / DELETE (204) |
| `/api/v1/roadmap-items` | POST (201) |
| `/api/v1/roadmap-items/{id}` | GET / PATCH / DELETE (204) |
| `/api/v1/roadmap-items/{id}/features` | POST `{feature_id}` (201, returns RoadmapItemRead) |
| `/api/v1/roadmap-items/{id}/features/{feature_id}` | DELETE (200, returns RoadmapItemRead) |

## 4. Frontend — top-level Roadmap view

- New nav entry **Roadmap** (ninth view). Product `FilterSelect`
  (`allowAll=false`, defaults to the first product); loading-before-empty;
  empty state "No streams yet. Add one to start the roadmap."
- **Timeline layout:** a pure helper `frontend/src/lib/roadmap.ts` computes
  the axis and bar geometry — `axisRange(items, today)` (min start / max end
  padded to full months, always spanning today) and
  `barGeometry(item, range)` → `{leftPct, widthPct}`; month gridlines with
  labels, a "today" marker line. Unit-tested independently of the component.
- **Swimlanes:** streams ordered by position; each lane header shows the
  stream name with inline rename (pencil → input, Admin-catalog pattern),
  up/down reorder buttons (aria `Move <name> up/down`), delete (guarded 409
  surfaces in the view's error strip). "Add stream" input at the bottom.
- **Bars:** absolutely positioned in the lane by `barGeometry`, colored by
  status — idea `bg-gray-200 text-gray-700`, planned `bg-blue-100
  text-blue-800`, committed `bg-violet-100 text-violet-800`, done
  `bg-emerald-100 text-emerald-800`, cancelled `bg-gray-100 text-gray-400
  line-through`; title inside the bar (truncated). "Add item" button per
  lane. Click bar → drawer.
- **RoadmapItemDrawer** (create/edit, keyed remount): title, description,
  status (PlainSelect, clearable=false), start/end `<input type="date">`
  (client-side ≤ check shows the error strip before submitting), stream
  (PlainSelect over the product's streams — enables moving), linked
  features — SearchableSelect `ariaLabel "Link feature"` over ALL features
  labeled `"Title (#id)"` excluding linked, rows with the feature's status
  and unlink buttons (`Unlink <title>`); link/unlink update local state from
  the returned item AND refresh the view; delete via ConfirmDialog; error
  strip.
- Features come from the already-loaded board data? No — the view is
  self-contained: it fetches feature options via the existing `listItems`
  client (kind=feature) or a lighter existing endpoint; implementation picks
  the existing client call that returns features with id+title+status
  without new backend work.
- Dark mode via existing tokens (the status colors above all have dark
  remaps).

## 5. Testing & verification

- **Backend (pytest, TDD):** date-range rule (create + update incl. the
  cross-field update case), stream guards + product guard, position
  assignment + reorder, same-product stream-move rule, link ops (duplicate /
  non-feature / missing), grouping + ordering of `GET /products/{id}/roadmap`,
  feature-delete drops the link (CASCADE path exercised on Postgres by the
  migration dry-run only — in SQLite fixtures assert via explicit adapter
  behavior), field-level audit incl. stream move by name.
- **Frontend (Vitest):** `lib/roadmap.ts` geometry math (axis padding,
  today-span, bar percentages, single-day items), view rendering (lanes,
  bars, status colors via class assertions), drawer create/edit/move/link,
  stream rename/reorder/delete-guard error, client function tests.
- **Migration 0029:** upgrade + downgrade dry-run against compose Postgres.
- **Stack:** Docker rebuild + Playwright walkthrough incl. dark mode;
  CLAUDE.md → head `0029`, nine top-level views.

## Out of scope (later)

- Drag-and-drop / resize of bars (edit via drawer only in this cut).
- Cross-product roadmap overviews; roadmap export/printing.
- Auto-derived progress from linked feature statuses.
- Quarter/PI snapping of dates.
