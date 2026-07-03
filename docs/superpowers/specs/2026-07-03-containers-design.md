# Containers (team- and PI-scoped item grouping) — Design

**Date:** 2026-07-03
**Status:** Approved (design gate) — pending spec review

## Context

The user needs logical units named **containers** to group features and stories.
A container belongs to exactly one (Planning Interval, Team) pair. Containers are
managed in the Admin UI. Decisions from the design gate (AskUserQuestion):

- **Item usage:** container is a field on the item (set in the ItemDrawer,
  options limited to the item's PI + leading team) plus a Container filter in
  the board's toolbar. Lanes/cards layout unchanged.
- **Defaults:** *Operations*, *Local Items*, *Strategic Items* are auto-created
  for every new (team, PI) pair; afterwards they are ordinary containers —
  renameable and deletable. *Operational Stability* exists only for PI1-Q3
  (seeded once, every team).
- **Data model:** items reference containers by FK `container_id`
  (ON DELETE SET NULL) — names repeat across scopes, so a name string would be
  ambiguous.

## 1. Data model (`backend/app/models.py`)

```python
class Container(Base):
    __tablename__ = "containers"
    __table_args__ = (
        UniqueConstraint("team_id", "planning_interval", "name",
                         name="uq_container_team_pi_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    planning_interval: Mapped[str] = mapped_column(String(64), index=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )

    team: Mapped["Team"] = relationship()
```

`planning_interval` is a name string — the same convention as `Capacity` and
`Item`; PI renames propagate (section 3). The team reference is an FK so team
renames are free and team deletion cascades.

`Item` gains:

```python
container_id: Mapped[int | None] = mapped_column(
    ForeignKey("containers.id", ondelete="SET NULL"), index=True
)
```

### Migration `0016_containers.py`

- Create `containers` (columns above, unique constraint, indexes).
- Add `items.container_id` with FK SET NULL + index.
- **Seed (data migration):** for every existing (team, PI) pair, insert the
  three defaults `Operations`, `Local Items`, `Strategic Items`; additionally
  insert `Operational Stability` for the PI named exactly `PI1-Q3` × every
  team (skipped if no such PI row exists — fresh databases get nothing).
  Read teams/PIs from the live tables with `sa.table()` lightweight constructs.
- Downgrade: drop `items.container_id` (FK + index first), drop `containers`.
- Verification per protocol: `alembic upgrade head` **and** `alembic downgrade
  -1` dry-run against the compose Postgres before acceptance (SQLite fixtures
  never run DDL).

## 2. Backend API (`backend/app/routers/containers.py`, new)

Prefix `/api/v1/containers`, following the teams/planning-intervals router
patterns exactly (require_admin on writes, audit via `log_event`).

Module-level constant + helper (imported by the teams and PI routers):

```python
DEFAULT_CONTAINER_NAMES = ("Operations", "Local Items", "Strategic Items")

def add_default_containers(db: Session, *, actor: User, teams: list[Team],
                           planning_intervals: list[str]) -> None:
    """db.add() + flush one container per (team, PI, default name), and
    log_event a `container.created` audit row for each (same entity_label
    format as the POST endpoint, actor = the admin whose team/PI creation
    triggered it). No commit."""
```

Endpoints:

- `GET ""` (any authenticated user) → `list[ContainerRead]`, ordered by
  `planning_interval, team_id, name`.
- `POST ""` (admin) — payload `ContainerCreate {name, planning_interval,
  team_id}`. 422 if `team_id` or `planning_interval` doesn't exist (matching
  the items router's 422 for bad `parent_id`); 409 if the (team, PI, name)
  triple already exists. Audit `container.created`, entity_type `container`,
  `entity_label=f"{name} ({team.name} · {planning_interval})"`.
- `PATCH "/{container_id}"` (admin) — rename. 404 unknown id; 409 duplicate
  name within the same (team, PI). Audit `container.renamed` with
  `field="name"`, old/new values.
- `DELETE "/{container_id}"` (admin) — guard: count of items with
  `container_id == id`; if > 0 and not `force`, 409 with detail
  `f"Container '{name}' is used by {n} items"`. With `force=true`: clear
  `container_id` on those items (bulk `update`, `synchronize_session=False`),
  then delete. Audit `container.deleted`.

Schemas (`backend/app/schemas.py`):

```python
class ContainerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    planning_interval: str
    team_id: int

class ContainerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    planning_interval: str = Field(min_length=1, max_length=64)
    team_id: int

class ContainerUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
```

## 3. Backend integration points

**Auto-create defaults** (ordinary rows afterwards; each auto-created
container is individually audited as `container.created`, alongside the
`team.created` / `planning_interval.created` event):

- `POST /teams` (`routers/teams.py`): after `db.flush()`, call
  `add_default_containers(db, actor=current, teams=[team],
  planning_intervals=<all PI names>)`.
- `POST /planning-intervals` (`routers/planning_intervals.py`): after flush,
  `add_default_containers(db, actor=current, teams=<all teams>,
  planning_intervals=[pi.name])`.

**PI rename** (`routers/planning_intervals.py`): add a third bulk `update`
propagating the name to `Container.planning_interval` (alongside Item and
Capacity).

**PI delete**: containers do **not** count toward the delete guard (auto-
creation means every PI always has containers — the guard would otherwise
always demand force). On delete (with or without force): clear
`Item.container_id` for items whose container belongs to this PI
(`Item.container_id.in_(select(Container.id).where(...))`), bulk-delete those
containers, then delete the PI.

**Team delete** (`routers/teams.py`): same explicit pattern before deleting the
team (SQLite tests don't enforce FK cascades): clear `Item.container_id` for
the team's containers, bulk-delete the containers, then proceed as today.
Guard unchanged (containers don't count).

**Item validation** (`routers/items.py`): `container_id` is added to
`ItemBase` (so `ItemCreate` and `ItemRead` carry it) and to `ItemUpdate`.
Shared helper:

```python
def _check_container(db, container_id, *, planning_interval, leading_team) -> Container:
    """422 if the container doesn't exist; 409 if its (PI, team) doesn't
    match the item's effective planning_interval / leading_team."""
```

- `create_item`: if `payload.container_id is not None`, validate against the
  payload's `planning_interval` / `leading_team`.
- `update_item`: after `changes` is computed, with
  `new_pi = changes.get("planning_interval", item.planning_interval)` and
  `new_team = changes.get("leading_team", item.leading_team)`:
  - if `"container_id" in changes` and not None → `_check_container` against
    the effective values (409 on mismatch, detail
    `"Container does not match the item's planning interval and leading team"`).
  - else if the item already has a container and the patch changes PI or
    leading team so the container no longer matches → **auto-clear**: set
    `changes["container_id"] = None` (before the `before` snapshot is taken,
    so the clear is audited).

**Item audit**: mirror the assignee pattern — audit the human-readable name,
not the id. Add `"container"` to `ITEM_TRACKED_FIELDS` (`app/audit.py`).
In `update_item`, when `container_id` is in the (possibly auto-cleared)
changes: `before["container"]` = old container's name (via
`db.get(Container, item.container_id)` before mutation, None if unset);
`changes["container"]` = new container's name (from the validated container,
None when clearing); pop `container_id` from the audit-facing changes dict
after applying setattr. No flush needed (unlike assignee) because both names
come from direct lookups. `create_item` needs no extra audit (item.created is
label-only, as today).

**Snapshot restore** (`app/snapshots.py`): mirror the `assignee_id` block —
collect existing container ids; for restored item rows whose `container_id`
is set but unknown, set it to None and warn
`f"Cleared container for {n} item(s) whose container no longer exists"`.
Old snapshots lack the key → `row.get` yields None → unaffected. The
containers table itself is master data (like teams) and is not part of
item snapshots.

CSV import: no container column; imported items get `container_id = None`.
No change needed.

## 4. Frontend

**Types** (`frontend/src/types.ts`): `Container {id, name, planning_interval,
team_id}`; `Item` gains `container_id: number | null`; the `ItemUpdate` type
gains `container_id?: number | null`.

**Client** (`frontend/src/api/client.ts`): `getContainers()`,
`createContainer(payload: {name, planning_interval, team_id})`,
`renameContainer(id, name)`, `deleteContainer(id, force = false)` — same shape
as the team functions (ConflictError on 409).

### Admin — `ContainersSection.tsx` (new, `components/admin/`)

New sidebar entry in `AdminView.tsx` between Planning Intervals and Snapshots:
`{ id: "containers", label: "Containers", icon: "📦" }`, rendering
`<ContainersSection planningIntervals={planningIntervals} />` (lazy mount like
the others; `AdminSection` union gains `"containers"`).

Section layout (AdminCard, accent `bg-violet-50 text-violet-600`, count =
containers in the selected scope):

- Header right group (same idiom as CapacitySection): Team `FilterSelect`
  (options = team names, "All" default) + PI pill row (selected PI state,
  defaults to first; empty-state copy when no PIs exist:
  "No planning intervals yet." — mirror CapacitySection's early return).
- Add row: a `<select>` of teams (`adminInputClass`; when the Team filter is
  active it defaults to that team) + name input + Add button
  (`adminAddButtonClass`). Creates in the selected PI. 409 → inline error
  text (TeamsSection idiom).
- List: rows grouped under team subheadings (`captionClass` team name, then
  that team's containers for the selected PI as `adminRowClass` rows), each
  with inline rename (✎ → input + Save/Cancel, TeamsSection idiom) and delete
  ✕. Delete 409 → `ConfirmDialog` ("Delete container?", detail from the API,
  confirm "Delete anyway") → force delete. Empty state: "No containers in
  this scope yet."
- Fetches containers, teams, and nothing else on mount; reloads after each
  mutation. Team changes elsewhere are covered by lazy remount on section
  switch.

### Item panel — `ItemDrawer.tsx`

New `PropLabel text="Container"` directly after **Leading Team**. Props: the
drawer gains `containers: Container[]` and `teams: Team[]` (App fetches
`getContainers()` in the existing refreshKey effect and keeps the full `Team[]`
from `getTeams` instead of only names).

- Effective scope = `value("planning_interval")` + `value("leading_team")`
  (draft-aware, so changing PI/team immediately rescopes the options).
- If either is unset: render
  `<p className="text-sm text-gray-400">Set planning interval and leading team first</p>`
  instead of the select.
- Otherwise a `SearchableSelect` (ariaLabel "Container"): options = names of
  containers where `planning_interval` matches and `team_id` equals the team
  whose name is the effective leading team; value = name of the container
  matching `value("container_id")` (null if the current container is out of
  scope — the server will clear it on save anyway); onChange maps the chosen
  name back to the container id within the scope and sets
  `draft.container_id` (null on clear).

### Board filter — `Toolbar.tsx`, `BoardView.tsx`, `App.tsx`

- `BoardFilters` gains `container?: string` (a container *name*, matching the
  FilterSelect string API); `hasActive` includes it.
- Toolbar gains `<FilterSelect label="Container" ...>` after Assignee, with
  `options={containerNames}` (new prop: sorted distinct names from the
  containers master list, computed in App).
- `BoardView` gains a `containers: Container[]` prop. `visible()` filters by
  id set: `f.container` → `ids = Set(containers.filter(c => c.name ===
  f.container).map(c => c.id))`; a card passes when
  `c.container_id != null && ids.has(c.container_id)`.
- App state: `const [containers, setContainers] = useState<Container[]>([])`,
  fetched in the refreshKey effect; passes `containers` to BoardView and
  ItemDrawer, `containerNames` to Toolbar, `teams` (full objects) to
  ItemDrawer.

## 5. Testing

**Backend** (pytest, SQLite fixtures):

- `test_api_containers.py` (new): list; create (+ 409 duplicate, 422 unknown
  team/PI); rename (+ 409 duplicate in scope); delete guard 409 with item
  count → force clears `container_id` and deletes; admin-only writes (403 as
  member).
- Auto-create: `POST /teams` creates 3 defaults per existing PI;
  `POST /planning-intervals` creates 3 defaults per existing team; each
  auto-created container emits a `container.created` audit event attributed
  to the acting admin.
- PI rename propagates to containers; PI delete removes its containers and
  clears `container_id` on affected items without force; team delete does the
  same for its containers.
- Items: create/patch with mismatched container → 409; matching → saved;
  patching PI (or leading team) away auto-clears the container and audits
  `container` old→None; audit uses container names.
- `test_snapshot_restore.py`: restoring a snapshot whose item references a
  now-missing container id clears it with a warning.

**Frontend** (vitest):

- `ContainersSection.test.tsx` (new): renders grouped rows for the selected
  PI scope; team filter narrows groups; add calls `createContainer` with the
  selected PI/team; delete 409 → ConfirmDialog → force.
- `AdminView.test.tsx`: `mockAll` gains `getContainers`; sidebar shows the new
  Containers entry (covered implicitly by the existing switching test pattern).
- `ItemDrawerFields.test.tsx` (or ItemDrawer tests): Container select shows
  only in-scope options; hint text when PI/team unset; choosing an option
  patches `container_id`.
- `Toolbar`/`BoardView` tests: Container FilterSelect filters cards by their
  container's name.

Verification: backend suite in container, `npx tsc --noEmit` + `npx vitest
run` from `frontend/`, migration dry-run (upgrade + downgrade) against compose
Postgres, rebuild frontend container, live check (read-only against real
data; scratch entities only).

## Out of scope

- Container on NewItemDialog / NewItemBar (assign via the drawer after
  creation).
- Board swimlanes or any grouping-by-container rendering; Planning/Timeline
  view grouping.
- Container-level capacity, WSJF, or reporting.
- Containers in item snapshots/CSV import (master data, not item data).
- Per-item audit events when a force-delete or PI/team deletion bulk-clears
  `container_id` (consistent with rename-propagation, which is also unaudited
  per item).
