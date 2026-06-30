# SAFe Feature/Story Kanban — Design

**Date:** 2026-06-30
**Status:** Approved (pending spec review)

## 1. Purpose

A single-user web application for managing SAFe **Feature**, **Story**, and **Risk**
items on a Kanban board, backed by Postgres. Items are imported from the
`Team Planning Q3 26.csv` planning export, where Stories are children of Features
and appear directly below their parent Feature in the file.

## 2. Scope

In scope:

- Import items from the CSV (replace-all semantics).
- Kanban board view of Features and Risks, grouped by `Status`.
- Features expand to reveal their child Stories.
- Full CRUD on Features, Stories, and Risks.
- Drag cards between status columns; reorder within a column.
- Filtering and title search.
- WSJF auto-recompute on edit.

Out of scope (v1):

- Authentication / multi-user (single-user local tool).
- Real-time collaboration.
- Export back to CSV.
- Audit history / undo.

## 3. Source data

`Team Planning Q3 26.csv` — 26 columns, UTF-8, German content with umlauts,
quoted multi-line cells, decimal numbers.

Columns:

```
Title, Description / Nutzenhypothese, Type, Kategorie, ART, SDI Prio, Status,
T-Shirt Size, WSJF Score, Story Points, Iteration, Leading Team, Supporting Team,
Externer Partner, Assignee, Akzeptanzkriterien, Dependencies, BO/Stakeholder,
Business Value / Direkter Nutzen, Time Criticality / Zukünftiger Nutzen,
Risk Reduction / Dringlichkeit, Cost of Delay, Job Size / Aufwand,
Parent, Child, Definition of Done (DoD)
```

`Type` values map to three kinds:

| CSV `Type`        | kind    |
| ----------------- | ------- |
| Enabler Feature   | feature |
| Feature           | feature |
| Enabler Story     | story   |
| Risk              | risk    |

Data quality facts that drive the design:

- **Titles are not unique.** "Dokumentation", "Testing", "Teil 1"…"Teil 5" recur
  under many Features. The Feature "NetApp AirGap Recovery - ruttm" appears twice
  (rows 23 and 27).
- **There is no ID column.** No stable key exists in the source.
- Therefore the parent↔child relationship is anchored by **CSV row position**, not
  by title matching. The `Parent`/`Child` text columns are used only as a
  cross-check during import (mismatches are logged as warnings), never as the link.

## 4. Architecture

```
React + Vite + TS + Tailwind  ──HTTP/JSON──>  FastAPI  ──SQLAlchemy──>  Postgres
        (@dnd-kit board)                     (Pydantic)   (Alembic)
```

- **Backend:** FastAPI, SQLAlchemy 2.0, Pydantic v2, Alembic migrations.
- **Frontend:** React + Vite + TypeScript + Tailwind, `@dnd-kit` for drag/drop.
- **Database:** Postgres (via `docker-compose.yml`).
- **Auth:** none (single-user local tool).

## 5. Data model

Single `items` table with a `kind` discriminator and a self-referential
`parent_id`. Chosen over separate tables because all three kinds share ~24 of 26
columns; this gives one CRUD surface and trivial hierarchy/board queries.

```
items
  id                 PK (app-generated, e.g. UUID or serial)
  kind               enum: feature | story | risk   (logic discriminator)
  type               text  (raw CSV "Type")
  parent_id          FK -> items.id, NULL for features/risks
  position           int   (preserves CSV order within a parent / column)

  title              text  (required)
  description        text
  kategorie          text
  art                text
  sdi_prio           text
  status             text
  tshirt_size        text
  wsjf_score         numeric
  story_points       numeric
  iteration          text
  leading_team       text
  supporting_team    text
  externer_partner   text
  assignee           text
  akzeptanzkriterien text
  dependencies       text   (free text reference; not a FK — titles not unique)
  bo_stakeholder     text
  business_value     int
  time_criticality   int
  risk_reduction     int
  cost_of_delay      numeric
  job_size           numeric
  definition_of_done text
  created_at         timestamptz
  updated_at         timestamptz
```

- The CSV `Child` column is **not** stored — it is derived from `parent_id`.
- WSJF-component columns (business_value, time_criticality, risk_reduction,
  cost_of_delay, job_size) are typically populated only on Features; NULL elsewhere.
- Deleting a Feature cascades to its child Stories.

## 6. CSV import

Endpoint: `POST /api/import` (multipart file upload). Replace-all semantics.

Algorithm:

1. Read with Python's `csv` module (handles quoted multi-line cells); decode UTF-8.
2. Walk rows top-to-bottom, tracking `current_feature`.
   - `Enabler Feature` / `Feature` → create Feature; it becomes `current_feature`;
     `parent_id = NULL`.
   - `Enabler Story` → create Story; `parent_id = current_feature.id`. If the
     `Parent` text column is present and does not match `current_feature.title`,
     record a warning but keep the positional link.
   - `Risk` → create Risk; `parent_id = NULL`; does **not** change `current_feature`.
   - Unknown `Type` → treat as kind `feature`, keep raw type, add a warning.
3. `position` assigned from row order (per parent for stories, global for top-level).
4. Numeric parsing: empty → `NULL`; accepts `0.5`, `12.6666…`, integers; a bad cell
   produces a row-level error rather than crashing.
5. Whole operation runs in **one transaction**: `DELETE` all items → bulk insert.
   On any failure it rolls back, leaving existing data intact.
6. Response: `{ "features": n, "stories": n, "risks": n, "warnings": [...] }`.

The UI requires a **confirm dialog** before calling this endpoint
("This deletes all current items and reloads from the file").

## 7. Backend API

```
POST   /api/import          replace-all from CSV upload
GET    /api/board           columns (by status) -> cards (features + risks),
                            each card with child-story summary (count, points sum)
GET    /api/items           flat list; filters: kind, status, iteration,
                            leading_team, assignee, q (title search)
GET    /api/items/{id}      single item incl. children
POST   /api/items           create feature / story / risk
PATCH  /api/items/{id}      edit any field; status move = PATCH {status};
                            reorder = PATCH {position}
DELETE /api/items/{id}      delete (Feature cascades to its Stories)
```

**WSJF recompute:** when an edit changes Business Value, Time Criticality,
Risk Reduction, or Job Size, the backend recomputes
`cost_of_delay = business_value + time_criticality + risk_reduction` and
`wsjf_score = cost_of_delay / job_size` (guarded against division by zero / NULL
job_size). Imported values are preserved as-is unless such an edit occurs.

Validation: Pydantic models per kind; 422 on invalid input, 404 on missing item.

## 8. Frontend

- **Board:** columns = distinct `Status` values ordered `Funnel → Analyzing → New`;
  unknown/blank status → an "Unscheduled" column. Cards = Features + Risks.
  A Feature card shows: title, type badge, WSJF score, summed child story points,
  leading team, iteration, child-story count. A Risk card shows title, type badge,
  category, leading team.
- **Drag:** move a card between columns → `PATCH {status}`; reorder within a column
  → `PATCH {position}`. Uses `@dnd-kit`.
- **Detail drawer:** click a card → drawer with all fields editable; child Stories
  listed with add / edit / delete / reorder and their own status.
- **Toolbar / filters:** Iteration, Leading Team, Type, Assignee, title search.
- **Actions:** Import CSV (file picker → confirm → upload → refresh);
  New Feature / New Story / New Risk; delete with confirm.
- Error feedback via toasts.

## 9. Testing

- **Backend (pytest):**
  - Import parser is the heaviest-tested unit, using the real
    `Team Planning Q3 26.csv` as a fixture. Asserts: correct feature/story/risk
    counts; positional parenting survives duplicate Feature titles
    ("NetApp AirGap Recovery - ruttm") and recurring Story titles
    ("Dokumentation", "Teil 1".."Teil 5"); numeric parsing of decimals, the long
    WSJF float, and empty cells; multi-line description cells preserved.
  - API CRUD tests against a disposable test database; replace-all rollback on
    induced failure; WSJF recompute on edit; Feature delete cascades to Stories.
- **Frontend (Vitest + React Testing Library):**
  - Board renders columns and cards from mocked `/api/board`.
  - Drag → status-change handler calls the right PATCH.
  - Import confirm flow (mocked API) refreshes the board.

## 10. Error handling

- Import: row-level error messages; whole import rolls back on failure (transaction).
- API: Pydantic 422 for bad input, 404 for missing resources.
- Frontend: toasts for errors; confirm dialogs for destructive actions
  (import replace-all, delete).

## 11. Running locally

- `docker-compose.yml` provides Postgres (and optionally backend/frontend services).
- Backend: `uvicorn`; Alembic migration creates the `items` table.
- Frontend: `vite` dev server, proxying `/api` to the backend.
