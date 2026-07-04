# PI Objectives — Design

**Date:** 2026-07-04
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Add a **PI Objective** entity: each team has objectives per Planning Interval,
each linkable to 0..n features, with a state (committed / uncommitted /
out-of-scope) and a Key Delivery flag that applies only to committed
objectives. Managed from a new "PI Objectives" tab inside the board view.

## Decisions (from brainstorming)

1. **UI:** a new board tab (next to Features & Stories / Risks) with columns by
   state; drag between columns to change state.
2. **Fields:** title + optional description (plus state and Key Delivery).
3. **Permissions:** team members (user's team matches the objective's team) and
   admins can create/edit/delete; others read-only.
4. **Feature linking:** only features with the same leading team **and** the
   same planning interval as the objective.

## Data model (backend)

### `pi_objectives` table

| Column                 | Type                          | Notes                                            |
| ---------------------- | ----------------------------- | ------------------------------------------------ |
| `id`                   | int PK                        |                                                  |
| `team_id`              | FK teams.id (ON DELETE CASCADE), indexed |                                       |
| `planning_interval_id` | FK planning_intervals.id (ON DELETE CASCADE), indexed |                          |
| `title`                | String(512), not null         |                                                  |
| `description`          | Text, nullable                |                                                  |
| `state`                | Enum `ObjectiveState` (non-native), indexed | default `uncommitted`             |
| `is_key_delivery`      | bool, not null, default false | true only when state == committed                |
| `position`            | int, not null, default 0      | ordering within a state column                   |
| `created_at`           | DateTime(tz)                  | server default now                               |
| `updated_at`           | DateTime(tz)                  | onupdate now                                     |

`ObjectiveState` = `committed` | `uncommitted` | `out_of_scope`, stored via
`Enum(ObjectiveState, native_enum=False)` (matches `ItemKind`).

### `pi_objective_features` join table

| Column             | Type                              |
| ------------------ | --------------------------------- |
| `pi_objective_id`  | FK pi_objectives.id (CASCADE), PK |
| `item_id`          | FK items.id (CASCADE), PK         |

Composite PK `(pi_objective_id, item_id)`. Mirrors `user_team_departments`.

Relationships: `PIObjective.team`, `PIObjective.planning_interval`,
`PIObjective.features` (`secondary=pi_objective_features` → `Item`).
Helper property `feature_ids -> list[int]`.

### Invariants (enforced in the service layer / router)

- **Key Delivery:** `is_key_delivery` may be true only when
  `state == committed`. Any update that sets state to a non-committed value
  forces `is_key_delivery = False`. A request setting `is_key_delivery=true`
  with a non-committed state is rejected (422).
- **Feature link scope:** a feature may be linked only if it is a
  `kind == feature` item with `leading_team == objective.team.name` **and**
  `planning_interval == objective.planning_interval.name`. Violations → 422.
- `title` is required and trimmed non-empty.

Optimistic locking (item-style `version`) is intentionally **out of scope** for
v1; objective updates are last-write-wins. Noted as a possible follow-up.

## API — `backend/app/routers/pi_objectives.py`

Prefix `/api/v1`, all endpoints require an authenticated user.

- `GET /pi-objectives?planning_interval=<name>&team=<name>` → `list[PIObjectiveRead]`.
  Both query params optional; when omitted, returns all. Ordered by
  `(state, position, id)`.
- `POST /pi-objectives` → 201 `PIObjectiveRead`. Body: `team_id`,
  `planning_interval` (name), `title`, `description?`, `state?`
  (default uncommitted), `is_key_delivery?`, `feature_ids?`. **Team-gated.**
- `PATCH /pi-objectives/{id}` → `PIObjectiveRead`. Optional: `title`,
  `description`, `state`, `is_key_delivery`, `position`. **Team-gated.**
- `PUT /pi-objectives/{id}/features` → `PIObjectiveRead`. Body:
  `feature_ids: list[int]` (full replace, validated for scope). **Team-gated.**
- `DELETE /pi-objectives/{id}` → 204. **Team-gated.**

**Team gate** (helper `_require_team(user, objective_team_id)`):
`user.role == "admin" or user.team_id == objective_team_id` else 403. For
`POST`, gate on the requested `team_id`.

Each mutation calls `log_event` (`pi_objective.created/updated/deleted`) and
commits, consistent with existing routers.

### Schemas (`schemas.py`)

- `PIObjectiveBase`: `title`, `description`, `state`, `is_key_delivery`.
- `PIObjectiveCreate(PIObjectiveBase)`: + `team_id`, `planning_interval`,
  `feature_ids: list[int] = []`.
- `PIObjectiveUpdate`: all optional (`title`, `description`, `state`,
  `is_key_delivery`, `position`).
- `PIObjectiveRead(PIObjectiveBase)`: + `id`, `team_id`, `team_name`,
  `planning_interval` (name), `position`, `feature_ids`, `feature_count`,
  `created_at`, `updated_at`.
- `FeatureLinkRequest`: `feature_ids: list[int]`.

## Migration

Alembic revision `0022` (down_revision `0021`):
- create `pi_objectives` (with the enum stored as a plain string column, no DB
  enum type — matches `items.kind` which uses `native_enum=False`).
- create `pi_objective_features`.
- indexes on `team_id`, `planning_interval_id`, `state`.
- downgrade drops both tables.
- Dry-run upgrade **and** downgrade against compose Postgres before accepting.

## Frontend

### New board tab

- Extend the board area so the active board tab may be either a real board id
  or the sentinel `"objectives"`. `BoardTabs` renders the real boards plus a
  trailing **PI Objectives** tab. Selecting it renders `PIObjectivesBoard`
  instead of `Toolbar` + `BoardView`.
- `PIObjectivesBoard` owns a board-style filter bar: **Planning Interval**
  (`FilterSelect` `allowAll=false`, defaults to the first PI) + **Team**
  (`FilterSelect`, "All" allowed).

### Columns and cards

- Three fixed columns: **Committed**, **Uncommitted**, **Out of scope**.
- Cards (`ObjectiveCard`) show: title, linked-feature count (e.g. "3 features"),
  team name (when Team filter = All), and a **Key Delivery** badge on committed
  key-deliveries.
- Cards are draggable between columns (`@dnd-kit`) → `PATCH state`. Moving out of
  Committed clears Key Delivery (server enforces; client mirrors). Drag is
  disabled for users who can't edit that objective's team.
- `+ New objective` button (enabled when the user may edit the selected team, or
  opens the editor with a team picker when Team = All).

### Editor (`ObjectiveEditor`, modal)

Fields: Team (`PlainSelect`, prefilled/locked to filter when specific), Planning
Interval (prefilled from filter, read-only), Title, Description, State
(`PlainSelect`), Key Delivery (toggle, disabled unless State = committed), and a
**feature multi-select** listing features scoped to the chosen team + PI
(checkbox list). Save calls `POST`/`PATCH` then `PUT .../features`.

### Client + types

- `types.ts`: `ObjectiveState`, `PIObjective`.
- `api/client.ts`: `getPIObjectives`, `createPIObjective`, `updatePIObjective`,
  `setObjectiveFeatures`, `deletePIObjective`.
- `App.tsx` wires the tab, passes `teams`, `planningIntervals`, current `user`.

### Permission in UI

Edit/create/delete controls shown only when `user.role === "admin"` or the
objective's team matches `user`'s team. Read-only users still see everything.

## Testing

**Backend**
- Model/service: key-delivery invariant (committed-only; auto-clear on leaving
  committed; 422 on committed=false + key=true); feature-link scope validation
  (wrong team or wrong PI → 422); team gate (non-member 403, admin allowed).
- Endpoints: create/list(filtered)/patch(state & fields)/put features/delete.
- Migration: dry-run upgrade+downgrade on compose Postgres; a seeded objective
  round-trips.

**Frontend**
- `PIObjectivesBoard`: renders three columns; objectives land in the right
  column by state; Key Delivery badge only on committed key-deliveries.
- Drag a card to another column issues a state PATCH.
- `ObjectiveEditor`: Key Delivery toggle disabled unless committed; feature list
  scoped to team+PI; save wires create/patch + features.
- Team-gated controls hidden for a non-member, non-admin user.
- Full existing suites stay green.

**Docker** — build images, create an objective, link features, drag between
states, confirm Key Delivery gating and persistence.

## Out of scope

- Business value / planned-vs-actual scoring.
- Optimistic locking on objectives.
- Objectives for anything other than teams (e.g. ART-level objectives).
- Reordering features within an objective (link set is unordered).
