# Product & Service Catalog — Design

Date: 2026-07-25
Status: Approved design, pending implementation plan

## Context and goal

JAMra grows from a SAFe Kanban tool into a product & service lifecycle manager
fitting an organization that runs SAFe (lean agile) and ITIL ITSM. This spec
covers **sub-project 1 of 4**: the Product & Service Catalog — the foundation
the later sub-projects build on:

1. **Product & Service Catalog** (this spec) — ARTs, products (team ≙ product),
   services/sub-services, service dependencies, exchangeable-datasource seam.
2. Components & systems with lifecycle (internal stages + vendor EoL/EoS).
3. Budget & support contracts on components.
4. Product roadmaps with streams (e.g. campus access / datacenter / backbone).

Sub-projects 2–4 get their own spec → plan → implementation cycles.

## Decisions made during brainstorming

- **Product ↔ Team:** new `Product` entity with an optional 1:1 link to the
  existing `Team`. Kanban core keeps working off `Team` untouched.
- **ART:** first-class entity. The free-text `items.art` column is migrated to
  a foreign key in this project (backfill + drop text column); the item API
  keeps exposing `art` as a string so the frontend is unaffected.
- **Service hierarchy:** arbitrary depth via `parent_service_id` self-link;
  a sub-service is just a service with a parent.
- **Dependencies:** typed edge (`requires`/`uses`) with criticality
  (`critical`/`important`/`optional`) and a free-text note.
- **Service attributes:** core + lifecycle state
  (`planned`/`active`/`deprecated`/`retired`). Full lifecycle management
  (dates, vendor EoL/EoS) is sub-project 2.
- **UI:** new top-level **Products** view (list + detail); dependency *graph*
  visualization deferred. ART/product CRUD lives in Admin.
- **Permissions:** ARTs and products admin-managed; services and dependencies
  editable by any signed-in user; everything viewable by all users.
- **Datasource exchangeability:** repository ports for the new catalog
  entities only, one Postgres adapter now. Future ServiceNow / LeanIX / Jira
  adapters implement the same ports and are selected per entity via config.
- **Architecture approach:** bounded-context package with pragmatic ORM
  (option A) — domain dataclasses + ports + adapter in `backend/app/catalog/`,
  ORM table classes stay in `models.py` so Alembic and the SQLite test
  fixtures keep working unchanged.

## 1. Domain model & data

Migration `0025` creates four tables:

### arts
| column | type | notes |
|---|---|---|
| id | int PK | |
| name | str(64) unique, not null | |
| description | text nullable | |
| created_at / updated_at | datetime | server defaults, like existing tables |

### products
| column | type | notes |
|---|---|---|
| id | int PK | |
| name | str(128) unique, not null | |
| description | text nullable | |
| art_id | FK → arts.id, not null, ON DELETE RESTRICT | a product lives in an ART |
| team_id | FK → teams.id, nullable, unique | optional 1:1 "team = product" link |
| created_at / updated_at | datetime | |

### services
| column | type | notes |
|---|---|---|
| id | int PK | |
| name | str(128) not null | unique per (product_id, parent_service_id) — enforced in the domain layer, not as a DB constraint (NULL parents defeat a plain unique index and `NULLS NOT DISTINCT` breaks the SQLite fixtures) |
| description | text nullable | |
| product_id | FK → products.id, not null, ON DELETE RESTRICT | |
| parent_service_id | FK → services.id, nullable, ON DELETE RESTRICT | parent must belong to the **same product** (domain-layer rule, not a DB constraint) |
| owner_user_id | FK → users.id, nullable, ON DELETE SET NULL | |
| lifecycle_state | enum: planned, active, deprecated, retired | default `planned` |
| created_at / updated_at | datetime | |

### service_dependencies
| column | type | notes |
|---|---|---|
| id | int PK | |
| from_service_id | FK → services.id, not null, ON DELETE CASCADE | the dependent service |
| to_service_id | FK → services.id, not null, ON DELETE RESTRICT | the depended-upon service; may belong to another product |
| dep_type | enum: requires, uses | |
| criticality | enum: critical, important, optional | |
| note | text nullable | |

Constraints: unique `(from_service_id, to_service_id)`; check
`from_service_id != to_service_id`. Cycles across services/products are
**allowed** (real service graphs contain them); impact analysis is a later
sub-project.

### Deletion guards (409 with a clear message, like user deletion)
- ART: blocked while products reference it.
- Product: blocked while it has services.
- Service: blocked while it has child services **or inbound dependencies**
  (its own outbound dependency rows cascade away).

### items.art migration (same migration 0025)
1. Insert into `arts` the distinct non-null, non-empty `items.art` values.
2. Add `items.art_id` FK → arts.id (nullable), backfill by name match.
3. Drop the `items.art` text column.

`Item.art` becomes a Python property returning the linked ART's name, so
`ItemOut.art: str | None` and the frontend stay unchanged. `art` remains
non-PATCHable (`ItemUpdate` still forbids it). CSV import resolves the ART
column by get-or-create on `arts.name`. Downgrade re-creates the text column
and backfills it from the FK before dropping `art_id`.

## 2. Datasource abstraction (DDD ports)

New package `backend/app/catalog/`:

- **`domain.py`** — plain dataclasses, no SQLAlchemy imports:
  `Art`, `Product`, `Service`, `ServiceDependency`, plus enums
  `LifecycleState`, `DependencyType`, `Criticality`. Domain-rule helpers live
  here (e.g. `validate_parent(service, parent)` → same product, no
  self-parenting).
- **`ports.py`** — `Protocol` classes the routers depend on:
  - `ArtRepository`: `list() / get(id) / create / update / delete`
  - `ProductRepository`: same CRUD + `list()` returns products with ART name,
    team id/name, and service count
  - `ServiceRepository`: CRUD + `tree(product_id)` (nested service tree) +
    `list_dependencies(service_id)` (outbound + inbound, with service/product
    names) + `add_dependency` / `remove_dependency`
  - Each port has a `read_only: bool` property. Routers return **405** on
    write calls when the active adapter is read-only (future external
    mirrors, e.g. LeanIX).
- **`adapters/postgres.py`** — SQLAlchemy implementation; maps ORM rows ↔
  domain dataclasses. The ORM classes (`Art`, `Product`, `Service`,
  `ServiceDependency`) live in `app/models.py` (single metadata, Alembic
  autogenerate, SQLite fixtures) but are imported **only** by this adapter.
- **`factory.py`** — `get_art_repo(db)`, `get_product_repo(db)`,
  `get_service_repo(db)` FastAPI dependencies. This is the single seam where
  configuration later selects a different adapter per entity; today each
  returns the Postgres adapter.

Raised domain errors map to HTTP: `CatalogNotFound` → 404,
`CatalogRuleViolation` (bad parent, duplicate dependency, self-loop) → 422,
`CatalogInUse` (deletion guards) → 409.

## 3. API surface

All endpoints under the existing `require_user` mount; audit-logged like
items via `app/audit.py`.

| Endpoint | Methods | Access |
|---|---|---|
| `/api/arts` | GET | all users |
| `/api/arts`, `/api/arts/{id}` | POST / PATCH / DELETE | admin |
| `/api/products` | GET (list incl. art_name, team, service_count) | all users |
| `/api/products/{id}` | GET (detail) | all users |
| `/api/products`, `/api/products/{id}` | POST / PATCH / DELETE | admin |
| `/api/products/{id}/services` | GET (nested tree) | all users |
| `/api/services` | POST | all users |
| `/api/services/{id}` | GET / PATCH / DELETE | all users |
| `/api/services/{id}/dependencies` | GET (outbound + inbound) | all users |
| `/api/services/{id}/dependencies` | POST (to_service_id, dep_type, criticality, note) | all users |
| `/api/services/{id}/dependencies/{dep_id}` | DELETE | all users |

Pydantic schemas in `schemas.py` mirror the domain dataclasses. Service
PATCH accepts: name, description, parent_service_id, owner_user_id,
lifecycle_state. Product PATCH: name, description, art_id, team_id.

## 4. Frontend

- **Products view** (new top-level nav entry beside Board / Planning /
  Timeline / Ranking, visible to all users):
  - Product cards grouped by ART, showing description, linked team, and
    service count. Click → product detail.
  - Product detail: expand/collapse service tree with lifecycle badge per
    service; "Add service" / "Add sub-service" for any signed-in user.
  - Service drawer (pattern of the existing item drawer): edit name,
    description, lifecycle state (PlainSelect), owner (SearchableSelect over
    users), parent; dependency list (outbound "depends on" + inbound "used
    by") with type + criticality pills, add via SearchableSelect over all
    services (grouped by product), remove with confirmation.
- **Admin → Catalog section**: ART CRUD and product CRUD (name, description,
  ART via PlainSelect, team link via PlainSelect showing only unlinked
  teams). Deletion follows the guard responses with confirmation dialogs.
- New FA duotone icons via `frontend/src/icons.ts`; types in `types.ts`;
  API functions in `api/client.ts`. Lifecycle badge colors use the semantic
  token/dark-remap system in `index.css`.

## 5. Testing & verification

- **Backend (pytest, TDD):** domain-rule tests (same-product parent,
  self-loop, duplicate edge, guard errors); adapter mapping tests
  (ORM ↔ dataclass round-trip, tree building, dependency listing);
  router tests per resource incl. permission checks (admin vs user) and the
  405 read-only path (via a stub read-only port); CSV import get-or-create
  ART test; item API still returns `art` string after migration.
- **Frontend (Vitest + Testing Library):** ProductsView grouping/counts,
  product detail tree expand/collapse, service drawer edit + dependency
  add/remove, Admin catalog section CRUD, client function tests.
- **Migration:** dry-run `alembic upgrade head` **and** `alembic downgrade -1`
  against the compose Postgres (SQLite fixtures never exercise the DDL),
  including the `items.art` backfill both directions on a copy with data.
- **Stack verification:** rebuild backend + frontend images, walk through the
  Products view, admin Catalog section, and a CSV re-import in the running
  Docker stack (Playwright) before merging.

## Out of scope (later sub-projects)

- Components/systems, vendor EoL/EoS, lifecycle dates (sub-project 2).
- Budget & support contracts (sub-project 3).
- Roadmaps & streams (sub-project 4).
- Dependency graph visualization and impact analysis.
- Any real external adapter (ServiceNow / LeanIX / Jira) — only the port
  seam and its read-only behavior are built now.
