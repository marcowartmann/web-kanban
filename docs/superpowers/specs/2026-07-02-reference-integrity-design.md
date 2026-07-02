# Reference Integrity — Design

**Date:** 2026-07-02
**Status:** Approved (design); pending spec review
**Context:** P1 of the enterprise-hardening package (P2 concurrency + /api/v1 + pagination,
P3 import safety, P4 timestamps + observability follow as separate specs).

## Goal

Items reference teams, team members, planning intervals, and lanes by **display
string** (`leading_team`, `supporting_team`, `assignee`, `planning_interval`,
`status`), while master tables exist beside them. Today renaming is impossible
(no endpoints) or unsafe (lane rename strands cards), and deleting master data
silently orphans item strings. This feature makes renames first-class and
propagated, makes deletes warn about usage, and clears the schema-hygiene
findings from the 2026-07-02 architecture review. Real FK columns remain a
separate future project — this makes the string world safe.

## Rename endpoints (new; admin-only)

All three follow the same shape. Propagating `UPDATE`s run in the **same
transaction** as the rename (bulk `update(Item)` with
`synchronize_session=False`), so rename + propagation commit atomically.
Renaming to the identical name is a no-op: 200, no propagation, no audit event
(mirrors `rename_lane`). Payload schemas use
`name: str = Field(min_length=1, max_length=<column width>)`.

### `PATCH /api/teams/{team_id}` — `TeamUpdate {name}` (max 128) → 200 `TeamRead`

- 404 `"Team not found"`; 409 `"Team already exists"` when another team has the name.
- Propagates: `items.leading_team` and `items.supporting_team` where they equal the old name.
- Audit: `team.renamed`, entity_type `team`, entity_id/label = team id/new name, field `name`, old → new.
- `users.team_id` and `team_members.team_id` are FKs — untouched, correct automatically.

### `PATCH /api/team-members/{member_id}` — `TeamMemberUpdate {name}` (max 128) → 200 `TeamMemberRead`

- 404 `"Member not found"`; 409 `"Member already exists"`.
- Propagates: `items.assignee`.
- Audit: `team_member.renamed`.

### `PATCH /api/planning-intervals/{pi_id}` — `PlanningIntervalUpdate {name}` (max 64) → 200 `PlanningIntervalRead`

- 404 `"Planning interval not found"`; 409 `"Planning interval already exists"`.
- Propagates: `items.planning_interval` **and** `capacities.planning_interval`.
- Audit: `planning_interval.renamed`.

### Lane rename propagation (existing `PATCH /api/lanes/{lane_id}`)

`rename_lane` additionally runs, in its existing transaction:

```
UPDATE items SET status = :new
WHERE status = :old AND kind IN (<the lane's board.kinds, split on ",">)
```

Kind-scoping matters because lane names repeat across boards ("Analyzing"
exists on both): renaming it on the Risks board must not move stories.
Existing validations (reserved "Unscheduled", duplicate-on-board 409) and the
`lane.renamed` event are unchanged.

**No per-item audit events from propagation** — the single `*.renamed` event
carries old → new, consistent with the import philosophy (one event for a bulk
effect).

## Delete guards (teams, team members, planning intervals)

`DELETE` gains `force: bool = False` as a query parameter. After the existing
404 check, when usage > 0 and `force` is false → **409** with these exact
details (counts are live at request time):

- Team: `"Team '<name>' is referenced by <n> items"` — n = count of items where
  `leading_team == name OR supporting_team == name` (each item counted once).
- Member: `"Member '<name>' is assigned to <n> items"` — n = count of items where `assignee == name`.
- Planning interval: `"Planning interval '<name>' is used by <i> items and <c> capacity entries"`
  — guard triggers when `i + c > 0`; both numbers always appear in the message.

With `force=true` (or usage 0) the existing delete flow runs unchanged,
including the team's explicit member-detach and the `*.deleted` audit events.
Lane delete keeps today's semantics (cards land in Unscheduled) — **no guard**.

## Migration `0012_reference_integrity` (`down_revision = "0011"`)

1. `op.drop_column("items", "dependencies")` — legacy CSV text, rendered nowhere;
   `item_links` is the single source of truth.
2. Indexes (Postgres does not auto-index FKs or filter columns):
   `ix_items_parent_id`, `ix_items_kind`, `ix_items_status`,
   `ix_items_planning_interval`, `ix_items_leading_team`, `ix_items_assignee`.
3. `op.create_check_constraint("ck_capacities_iteration", "capacities",
   "iteration >= 1 AND iteration <= 6")`.
4. NOT NULL alignment for the six `created_at` columns that drifted
   (migrations omitted `nullable=False`; models are non-Optional):
   `item_links`, `planning_intervals`, `users`, `user_sessions`,
   `audit_events`, `comments`. Each gets a defensive
   `UPDATE <table> SET created_at = now() WHERE created_at IS NULL` before
   `ALTER COLUMN ... SET NOT NULL`.
5. Downgrade mirrors all of it (re-adds `dependencies` as nullable Text).

**Model/migration parity rule:** `models.py` gains the matching declarations —
`index=True` on the six item columns, `CheckConstraint` in
`Capacity.__table_args__`, `dependencies` field removed — so the SQLite test
fixtures (`create_all`) enforce exactly what the Postgres migration creates.
This closes the drift pattern at the source.

## Backend file changes (beside the routers)

- `app/models.py` — as above.
- `app/schemas.py` — remove `dependencies` from `ItemBase` and `ItemUpdate`;
  add `TeamUpdate`, `TeamMemberUpdate`, `PlanningIntervalUpdate`.
- `app/audit.py` — remove `"dependencies"` from `ITEM_TRACKED_FIELDS`.
- `app/csv_import.py` — drop the `"dependencies": g(COL_DEPENDENCIES)` mapping
  (and the now-unused `COL_DEPENDENCIES` constant); the CSV column is ignored.

## Frontend

**Client (`api/client.ts`):**

- `renameTeam(id: number, name: string): Promise<Team>`,
  `renameTeamMember(id: number, name: string): Promise<TeamMember>`,
  `renamePlanningInterval(id: number, name: string): Promise<PlanningInterval>` — PATCH `{name}`.
- `deleteTeam(id, force = false)`, `deleteTeamMember(id, force = false)`,
  `deletePlanningInterval(id, force = false)` — append `?force=true` when set.
- New `ConflictError extends Error` with a `detail: string` field: the shared
  `request()` throws it for 409 responses (detail parsed from the JSON body,
  raw text as fallback). All other statuses keep today's generic `Error`, so
  existing catch sites are unaffected.

**Admin sections (`TeamsSection`, `TeamMembersSection`,
`PlanningIntervalsSection`):**

- Each row gains a `Rename` action that swaps the name for an inline input with
  `Save` / `Cancel`, mirroring LaneEditor's interaction; duplicate-name 409s
  surface in the section's existing error line.
- Delete flow: call the delete fn; on `ConflictError` show
  `window.confirm(`${detail} Delete anyway?`)`; on confirm retry with
  `force = true`.
- `types.ts`: remove `dependencies` from `Item` and the update payload type;
  test fixtures referencing it are scrubbed (mechanical, no behavior change).

## Testing

**Backend** (new `tests/test_api_renames.py` + extensions):

- Per entity: rename 200 + propagation asserted on items (PI also on
  capacities); items matching other names untouched; duplicate 409 with the
  exact detail string; same-name no-op writes no audit event; 404; the
  `*.renamed` audit event with field/old/new.
- Lane kind-scoping: same lane name on both boards; renaming on one board
  rewrites only items of that board's kinds.
- Delete guards per entity: in-use → 409 with the exact counted message;
  `force=true` → 204 + `*.deleted` event; zero-usage → 204 without force.
- Hygiene: capacity with `iteration=7` raises IntegrityError (CHECK enforced in
  SQLite fixtures too); items response no longer contains `dependencies`;
  inspector sees the six new item indexes.

**Frontend:** client fns hit the right URLs/methods (incl. `?force=true` and
`ConflictError` on 409); one section's full rename flow (input → save →
refetch) plus the force-delete confirm flow; other sections' rename smoke;
suites stay green after the fixture scrub.

## Scope guards (v1)

- No FK columns on items (separate future feature); renames keep strings safe.
- No WSJF-value CHECK constraints (UI enforces the 1/2/3/5/8/13/20 scale;
  imported historical data may predate it).
- No lane delete guard; no board rename (nothing references board names).
- `externer_partner` / `bo_stakeholder` stay free text (not master-data backed).
- No live board refresh after renames — views refetch on mount, as today.
- Re-importing an old CSV recreates old names (import is replace-world by design).
