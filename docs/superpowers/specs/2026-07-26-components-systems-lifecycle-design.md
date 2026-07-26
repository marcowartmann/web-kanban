# Components & Systems with Lifecycle — Design

Date: 2026-07-26
Status: Approved design, pending implementation plan

## Context and goal

Sub-project 2 of 4 in the product & service lifecycle roadmap (sub-project 1,
the Product & Service Catalog, is merged — see
`2026-07-25-product-service-catalog-design.md`). This spec adds the technology
layer beneath services: **component types and systems with lifecycle
management**, including vendor end-of-life / end-of-support milestones (e.g.
Cisco networking hardware inside the Network product), and surfaces the
resulting risk on services and in a dedicated Lifecycle view.

Out of scope here, coming later: budget & support contracts on components
(sub-project 3), product roadmaps with streams (sub-project 4).

## Decisions made during brainstorming

- **Granularity:** components are **type-level** records ("Cisco Catalyst 9300
  access switches"), not per-device instances; an optional `quantity` captures
  fleet size. Instance-level data stays in external CMDBs and can arrive later
  through the repository seam.
- **Systems are compositions of components:** a system is a named grouping
  (e.g. "Campus fabric") owned by a product, containing component types
  many-to-many, each membership with an optional quantity.
- **Service links:** a service can be provided by **both** systems and
  individual components; links may cross products (like service dependencies).
- **Vendors:** first-class entity, created implicitly via get-or-create by
  name when referenced from a component (same pattern as ARTs). No vendor
  deletion in this cut.
- **Vendor dates:** the four Cisco-style milestones as optional date columns —
  `eos_announced`, `end_of_sale`, `end_of_support`, `end_of_life`.
- **Lifecycle stages:** components and systems get a NEW ITIL-flavored enum
  `plan | build | operate | phase_out | retired`. Services keep their existing
  `planned/active/deprecated/retired` enum.
- **UI scope:** product detail grows Systems/Components sections with drawers;
  the service drawer gets a "Provided by" block; risk badges throughout; PLUS
  a dedicated top-level **Lifecycle** view listing all components across
  products.
- **Permissions:** components, systems, and service-tech links are editable by
  any signed-in user (same as services); vendors are created implicitly.
- **Architecture:** extends the existing `backend/app/catalog/` bounded
  context (domain dataclasses + ports + Postgres adapter + factory). ORM
  classes live in `models.py`; migration `0027`.

## 1. Domain model & data

Migration `0027` creates five tables:

### vendors
| column | type | notes |
|---|---|---|
| id | int PK | |
| name | str(128) unique, not null | get-or-create by trimmed name |
| notes | text nullable | |
| created_at / updated_at | datetime | server defaults, as elsewhere |

### components
| column | type | notes |
|---|---|---|
| id | int PK | |
| name | str(128) not null | unique per product (DB constraint `(product_id, name)`) |
| model | str(64) nullable | vendor part/model no., e.g. "C9300-48P" |
| description | text nullable | |
| product_id | FK → products.id, not null, ON DELETE RESTRICT | |
| vendor_id | FK → vendors.id, nullable, ON DELETE SET NULL | |
| lifecycle_stage | enum LifecycleStage, default `plan` | persisted lowercase via `values_callable`, VARCHAR(16) |
| quantity | int nullable | fleet size (type-level) |
| eos_announced | date nullable | EoL/EoS announcement |
| end_of_sale | date nullable | |
| end_of_support | date nullable | last day of support (LDoS) |
| end_of_life | date nullable | |
| created_at / updated_at | datetime | |

### systems
| column | type | notes |
|---|---|---|
| id | int PK | |
| name | str(128) not null | unique per product (DB constraint) |
| description | text nullable | |
| product_id | FK → products.id, not null, ON DELETE RESTRICT | |
| lifecycle_stage | enum LifecycleStage, default `plan` | |
| created_at / updated_at | datetime | |

### system_components
`system_id` FK → systems (CASCADE), `component_id` FK → components (RESTRICT),
`quantity` int nullable; unique `(system_id, component_id)`.

### service_components / service_systems
`service_id` FK → services (CASCADE) + `component_id` / `system_id` FK
(RESTRICT); unique pair constraints. Cross-product links allowed.

### Enums (in `catalog/domain.py`)
- `LifecycleStage`: `plan | build | operate | phase_out | retired`.
- `RiskLevel`: `ok | warning | danger` (computed, never stored).

### Risk rules (pure domain functions)
- `component_risk(component, today)` → `danger` if `end_of_support` or
  `end_of_life` is on/before `today`; `warning` if either falls within the
  next 365 days; else `ok`. Missing dates simply don't trigger.
- `worst_risk(levels)` → max by severity (danger > warning > ok).
- A **system's risk** = worst of its member components.
- A **service's rolled-up risk** = worst of its directly linked components
  plus all components of its linked systems.

### Deletion guards (409 with a clear message)
- Component: blocked while it is a member of any system OR linked to any
  service.
- System: blocked while linked to any service (its component memberships are
  removed with it).
- Vendor: no delete endpoint in this cut.
- Product deletion remains blocked by services (existing guard) and is now
  also blocked while it has components or systems.

## 2. Ports & adapter (extends `backend/app/catalog/`)

- `domain.py`: dataclasses `Vendor`, `Component` (with read-side `vendor_name`,
  `product_name`, `risk`), `System` (with `components: list[SystemMember]`,
  read-side `risk`), `SystemMember` (component + quantity), `ServiceTech`
  (components + systems + rolled `risk` for one service); enums and risk
  functions above.
- `ports.py`:
  - `VendorRepository`: `list()`.
  - `ComponentRepository`: `list(product_id) / list_all() / get / create /
    update / delete`; create/update accept `vendor_name` (get-or-create).
  - `SystemRepository`: `list(product_id) / get / create / update / delete /
    set_member(system_id, component_id, quantity) / remove_member(...)`.
  - `ServiceRepository` gains: `list_tech(service_id) -> ServiceTech`,
    `add_tech_component / remove_tech_component`, `add_tech_system /
    remove_tech_system`.
  - All ports keep the `read_only` property; writes on read-only adapters
    answer 405.
- `adapters/postgres.py` + `factory.py` extended accordingly. Risk is computed
  in the adapter read paths using `date.today()` passed in from the router
  layer (kept injectable for tests).

## 3. API surface

All endpoints under `require_user`; any signed-in user may write; audit-logged
via `log_event` with field-level events on updates (established convention:
change detection by id/value, names in the log). Existing exception handlers
map domain errors to 404/422/409.

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/v1/vendors` | GET | picker list |
| `/api/v1/products/{id}/components` | GET | risk-annotated list |
| `/api/v1/components` | POST | accepts `vendor_name` |
| `/api/v1/components/{id}` | GET / PATCH / DELETE | PATCH accepts name, model, description, vendor_name, lifecycle_stage, quantity, the four dates |
| `/api/v1/products/{id}/systems` | GET | with members + risk |
| `/api/v1/systems` | POST | |
| `/api/v1/systems/{id}` | GET / PATCH / DELETE | |
| `/api/v1/systems/{id}/components` | PUT | body `{component_id, quantity}` — add or update membership |
| `/api/v1/systems/{id}/components/{component_id}` | DELETE | |
| `/api/v1/services/{id}/tech` | GET | `{components: [...], systems: [...], risk}` |
| `/api/v1/services/{id}/tech/components` | POST `{component_id}` | |
| `/api/v1/services/{id}/tech/components/{component_id}` | DELETE | |
| `/api/v1/services/{id}/tech/systems` | POST `{system_id}` | |
| `/api/v1/services/{id}/tech/systems/{system_id}` | DELETE | |
| `/api/v1/lifecycle` | GET | flat cross-product component list: name, model, product_name, vendor_name, lifecycle_stage, four dates, risk — for the Lifecycle view |

## 4. Frontend

- **Product detail tabs:** Services | Systems | Components (Services remains
  the default). Components tab: rows with vendor, model, stage badge, risk
  badge; component drawer edits all fields — vendor via SearchableSelect with
  on-the-fly create, stage via PlainSelect, four `<input type="date">` fields
  styled with `inputClass`. Systems tab: rows with member count + risk badge;
  system drawer edits fields and manages member components (SearchableSelect
  over the product's components, quantity input, remove).
- **Service drawer "Provided by" block:** add/remove systems and components
  (SearchableSelect over all, labeled "Name (Product)"), each row with a risk
  badge; the drawer header shows the service's rolled-up risk badge when not
  `ok`.
- **Lifecycle view:** new top-level nav entry (all users). Table of all
  components: Component (name + model), Product, Vendor, Stage,
  End of Sale, End of Support, End of Life, Risk. Default sort: risk severity
  first, then nearest end_of_support/end_of_life. FilterSelect for product,
  pill toggle "Only at risk". Row click opens nothing in this cut (navigation
  to the product detail is a later nicety).
- Risk badge styling: `warning` = amber tint, `danger` = red tint (existing
  token/dark-remap system); stage badges reuse the neutral badge pattern.
- New types + client functions in `types.ts` / `api/client.ts`.

## 5. Testing & verification

- **Backend (pytest, TDD):** risk-function boundary tests (dates on/around
  today and the 365-day edge), get-or-create vendor, membership ops,
  uniqueness (DB constraint per product), all deletion guards, service tech
  rollup incl. via-system components, `/lifecycle` ordering, permission checks
  (member client can write), read-only 405 path, field-level audit on
  component/system updates.
- **Frontend (Vitest):** product-detail tabs, component/system drawers,
  service "Provided by" block, Lifecycle view sorting + only-at-risk filter,
  client function tests.
- **Migration 0027:** `alembic upgrade head` and `alembic downgrade -1`
  dry-run against compose Postgres.
- **Stack:** Docker rebuild + Playwright walkthrough incl. dark mode.

## Out of scope (later)

- Budget & support contracts (sub-project 3 — will reference components and
  vendors).
- Roadmaps & streams (sub-project 4).
- Component instances / serials, external CMDB adapters (only the port seam).
- Vendor management UI (rename/merge/delete), EoL notifications, dashboards
  beyond the Lifecycle table.
