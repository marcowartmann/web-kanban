# Budget & Support Contracts — Design

Date: 2026-07-26
Status: Approved design, pending implementation plan

## Context and goal

Sub-project 3 of 4 in the product & service lifecycle roadmap (sub-projects 1
and 2 — the Product & Service Catalog and Components & Systems Lifecycle — are
merged; see their specs in this directory). This spec adds the financial layer
on components: **support contracts with expiry tracking** and **simple yearly
budget fields**, surfaced per product and in a cross-product Contracts view.

Out of scope here, coming later: product roadmaps with streams (sub-project 4).

## Decisions made during brainstorming

- **Scope:** a `SupportContract` entity linkable to components, plus two plain
  budget fields on Component. No full finance module, no planned-vs-actual, no
  currency handling (one implicit currency).
- **Cardinality:** contract ↔ component is many-to-many (one SmartNet covers
  many switches; a switch can carry hardware + software contracts).
- **Expiry stays out of the risk system:** contracts get their own computed
  `ContractStatus` (`active | expiring | expired`); the component `RiskLevel`
  and service rollups remain purely vendor-lifecycle-driven.
- **Budget:** component-level only — `yearly_run_cost` and
  `replacement_budget` on Component; `yearly_cost` on the contract.
  Product-level totals are computed sums in the UI.
- **UI:** Contracts tab in product detail + read-only contracts section in the
  component drawer + a top-level Contracts view (expiry-sorted, like the
  Lifecycle view). Linking is managed from the contract side only.
- **Ownership/links:** a contract belongs to one product (the buying product);
  component links may cross products (consistent with service tech links).
- **Architecture:** extends `backend/app/catalog/` (domain + ports + Postgres
  adapter + factory); ORM in `models.py`; migration `0028`; everything
  editable by any signed-in user; field-level audit.

## 1. Domain model & data

Migration `0028`:

### support_contracts
| column | type | notes |
|---|---|---|
| id | int PK | |
| name | str(128) not null | unique per product (DB constraint `(product_id, name)`) |
| contract_no | str(64) nullable | vendor's contract number |
| product_id | FK → products.id, not null, ON DELETE RESTRICT | owning product |
| vendor_id | FK → vendors.id, nullable, ON DELETE SET NULL | |
| start_date | date nullable | |
| end_date | date nullable | no end = evergreen (always `active`) |
| yearly_cost | numeric nullable | one implicit currency |
| notice_period_days | int nullable, ge 0 | renewal notice window |
| notes | text nullable | |
| created_at / updated_at | datetime | server defaults, as elsewhere |

### contract_components
`contract_id` FK → support_contracts (CASCADE), `component_id` FK → components
(RESTRICT); unique pair. Cross-product links allowed.

### Component budget fields
`yearly_run_cost` numeric nullable, `replacement_budget` numeric nullable —
added to the `components` table and to the existing component create/update
API surface.

### ContractStatus (computed, never stored)
- `expired` — `end_date` is on/before today.
- `expiring` — `end_date` within the next `notice_period_days` days
  (default 90 when unset).
- `active` — otherwise, including contracts with no `end_date`.

### Deletion guards (409)
- Component: additionally blocked while linked to any contract.
- Product: additionally blocked while it has contracts.
- Contract: deletable at any time (its links are removed with it — explicit
  deletes for the SQLite fixtures, per the established pattern).

## 2. Ports & adapter (extends `backend/app/catalog/`)

- `domain.py`: dataclasses `ContractComponentSummary(id, name, product_name)`
  and `SupportContract(id, name, contract_no, product_id, vendor_id,
  start_date, end_date, yearly_cost, notice_period_days, notes; read-side:
  vendor_name, product_name, status, components: list[ContractComponentSummary])`;
  enum `ContractStatus`; pure function
  `contract_status(*, end_date, notice_period_days, today) -> ContractStatus`.
- `ports.py`: `ContractRepository` — `list(product_id, today=None)`,
  `list_all(today=None)` (expiry-sorted: expired first, then soonest
  `end_date`, evergreen last, name tiebreak), `get`, `create` (accepts
  `vendor_name` get-or-create), `update(changes)` (exclude-unset semantics),
  `delete`, `link_component(contract_id, component_id)`,
  `unlink_component(contract_id, component_id)`. `read_only` property as
  everywhere; duplicates → `CatalogRuleViolation("This link already exists")`;
  missing link on unlink → `CatalogNotFound("Link not found")`.
- Adapter + factory extended accordingly; status computed with injectable
  `today`; linked components returned as lightweight summaries (id, name,
  product_name) for the drawer lists.
- Component drawer's read-only contract list: the component API
  (`ComponentRead`) gains `contracts: list[ContractSummary]` (id, name,
  status, end_date) filled by the adapter.

## 3. API surface

All under `require_user`, any signed-in user writes, audit-logged
(`contract.created/updated/deleted`, `contract.component_linked/unlinked`
with component names as values; updates field-level, vendor by name, dates
and costs as plain values).

| Endpoint | Methods |
|---|---|
| `/api/v1/products/{id}/contracts` | GET (status-annotated) |
| `/api/v1/contracts` | GET (flat, expiry-sorted) / POST (201) |
| `/api/v1/contracts/{id}` | GET / PATCH / DELETE (204) |
| `/api/v1/contracts/{id}/components` | POST `{component_id}` (201) |
| `/api/v1/contracts/{id}/components/{component_id}` | DELETE (204) |

Component schemas gain `yearly_run_cost` / `replacement_budget`
(create/update/read) and `contracts` (read only).

## 4. Frontend

- **Contracts tab** in product detail (fourth tab): rows — name, vendor,
  end date (or "—"), status badge (`expired` red / `expiring` amber tints,
  nothing for active), yearly cost; totals footer summing contract yearly
  costs, component yearly run costs, and replacement budgets for the product
  (client-side sums over already-loaded lists). "Add contract" + row click →
  ContractDrawer.
- **ContractDrawer**: name, contract no., vendor (SearchableSelect with
  on-the-fly create), start/end date inputs, yearly cost + notice-period
  number inputs, notes; linked-components section — cross-product
  SearchableSelect ("Name (Product)") to link, rows with unlink buttons;
  delete behind ConfirmDialog; error strip; key-based remount.
- **Component drawer**: two budget number inputs (aria-labeled) + read-only
  "Contracts" list with status badges.
- **Contracts view**: new top-level nav entry; table Contract / Product /
  Vendor / End date / Status / Yearly cost; FilterSelect product + pill
  "Only expiring or expired"; server-sorted (no client re-sort); loading
  state before empty state ("No contracts yet. Add them on a product's
  Contracts tab.").
- Status badge component: reuse the RiskBadge pattern (new small
  `ContractBadge` or a generalized badge — implementation's choice, colors
  amber/red tints as elsewhere; nothing rendered for `active`).

## 5. Testing & verification

- **Backend (pytest, TDD):** `contract_status` boundary tests (end today /
  +1 / notice edge with default 90 and custom values / evergreen), CRUD +
  link/unlink + duplicate/missing-link errors, sorting of `list_all`,
  guards (component delete blocked by contract link; product delete blocked
  by contracts; contract delete cleans links — asserted via row count),
  component budget fields round-trip + field-level audit incl. costs,
  permission (member client writes), read-only 405 path.
- **Frontend (Vitest):** Contracts tab rows + totals, ContractDrawer
  create/edit/link/unlink, component-drawer budget fields + read-only list,
  Contracts view sorting-preserved/filters/loading, client function tests
  (URL/method/body).
- **Migration 0028:** upgrade + downgrade dry-run against compose Postgres.
- **Stack:** Docker rebuild + Playwright walkthrough incl. dark mode.

## Out of scope (later)

- Roadmaps & streams (sub-project 4).
- Currency handling, planned-vs-actual, budget years/periods.
- Vendor merge/rename cleanup UI (noted follow-up from sub-project 2).
- Contract expiry notifications; document attachments.
