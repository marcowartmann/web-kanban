# Audit Log / Activity Trail — Design

**Date:** 2026-07-02
**Status:** Approved (design); pending spec review

## Goal

Every meaningful change in the app is recorded — who, what, when, old → new —
covering **items** (field-level), **dependency links**, **CSV imports**,
**admin master data** (teams, members, planning intervals, capacity, lanes),
**user management**, and **auth events** (logins, failed logins, logouts).
Surfaced in two places: an **Activity** section in the item drawer (per-item
history, visible to all members) and a full-width **Audit Log** panel on the
Admin page (everything, admin-only, filterable, Load more).

Actor = the session user from `require_user` (auth shipped earlier today).

## Data model (migration `0010_audit_events`, `down_revision = "0009"`)

```python
class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)
    actor_id: Mapped[int | None] = mapped_column(Integer)        # snapshot, NO FK
    actor_name: Mapped[str | None] = mapped_column(String(120))  # snapshot
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    entity_type: Mapped[str] = mapped_column(String(20))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    entity_label: Mapped[str | None] = mapped_column(String(500))  # item title / team name / email…
    field: Mapped[str | None] = mapped_column(String(40))
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("ix_audit_events_entity", "entity_type", "entity_id"),)
```

**Deliberately zero foreign keys** — audit rows are immutable history and must
survive deletion of items, teams, and (deactivated) users; the snapshots carry
the display names. The migration creates the table plus the single-column
indexes (`created_at`, `event_type`) and the composite entity index.

## Writer — `backend/app/audit.py`

```python
def log_event(
    db: Session,
    *,
    actor: User | None,
    event_type: str,
    entity_type: str,
    entity_id: int | None = None,
    entity_label: str | None = None,
    field: str | None = None,
    old_value: str | None = None,
    new_value: str | None = None,
) -> None:
```

- `db.add(AuditEvent(...))` only — **no commit**; the event joins the caller's
  transaction and commits atomically with the mutation it describes.
- `actor` None → `actor_id`/`actor_name` NULL (failed logins). Otherwise both
  snapshot from the `User`.
- Values are stored stringified: `None` stays `NULL`, everything else `str(value)`.

**Item field diffing** — `ITEM_TRACKED_FIELDS`: every `ItemUpdate` field
EXCEPT `position` (drag-reorder noise) and never the derived
`wsjf_score`/`cost_of_delay` (their inputs `business_value`,
`time_criticality`, `risk_reduction`, `job_size` are tracked).
`diff_item_changes(before: dict, changes: dict) -> list[tuple[field, old, new]]`
returns one entry per tracked field whose value actually changed
(`before[f] != changes[f]`).

## Event catalog (exact `event_type` / `entity_type` strings)

| event_type | entity_type | entity_id / label | field / old / new |
|---|---|---|---|
| `item.created` | `item` | item id / title | — |
| `item.updated` | `item` | item id / title | one row PER changed tracked field, old → new |
| `item.deleted` | `item` | item id / title | — ; cascaded child stories each get their own row |
| `link.added` / `link.removed` | `item` | one row PER endpoint item (id/title) | field=`link`, new_value (added) or old_value (removed) = `"<relation> → #<other id> <other title>"` |
| `import.replaced` | `import` | NULL / filename | new_value = `"features=N stories=M risks=K"` |
| `team.created` / `team.deleted` | `team` | team id / name | — |
| `team_member.created` / `team_member.deleted` | `team_member` | member id / name | — |
| `planning_interval.created` / `planning_interval.deleted` | `planning_interval` | pi id / name | — |
| `capacity.set` | `capacity` | capacity id / `"<member> · <PI> · I<slot>"` | field=`points`, old → new (old NULL on first set) |
| `lane.created` / `lane.renamed` / `lane.deleted` | `lane` | lane id / lane name | renamed: field=`name`, old → new |
| `lanes.reordered` | `board` | board id / board name | — |
| `user.created` | `user` | user id / email | — |
| `user.updated` | `user` | user id / email | one row per changed field (`email`, `display_name`, `role`, `is_active`, `team_id` — old/new as team NAMES when resolvable); `password` reset → field=`password`, old and new = `"***"` |
| `user.password_changed` | `user` | own id / email | field=`password`, values `"***"` |
| `auth.login` | `auth` | user id / email | — |
| `auth.login_failed` | `auth` | NULL / attempted email (lowercased) | — ; actor NULL |
| `auth.logout` | `auth` | user id / email | — |

Passwords are NEVER stored in any value — always the literal `"***"`.

## Instrumentation (write sites)

Mutating endpoints gain `current: User = Depends(require_user)` where missing
(items, links, imports, teams, team_members, planning_intervals, capacities,
boards). No authorization change — those routers are already behind
`require_user` at registration; this only surfaces the user object.

- `items.py`: create → `item.created`; update → capture tracked before-values,
  apply, then one `item.updated` row per real change; delete → `item.deleted`
  for the item AND each cascaded child.
- `links.py`: create/delete → `link.added`/`link.removed`, one row per
  endpoint item (both sides), labels/values per the catalog.
- `imports.py`: after `replace_all` → single `import.replaced` with the upload
  filename as `entity_label` and the counts summary. (Individual item
  create/delete events are deliberately NOT written during import.)
- `teams.py`, `team_members.py`, `planning_intervals.py`: created/deleted.
- `capacities.py` (PUT upsert): `capacity.set` with old points (NULL when new).
- `boards.py`: lane create/rename/delete + `lanes.reordered`.
- `users.py`: `user.created`; `user.updated` per changed field (password
  redacted; `team_id` old/new rendered as team names when the ids resolve,
  else the raw ids as strings).
- `routers/auth.py`: `auth.login` (success, before returning),
  `auth.login_failed` (in the identical-401 branch — actor NULL, label =
  normalized attempted email), `auth.logout` (only when a session actually
  resolved), `user.password_changed` in `/me/password`.
  Failed-login logging must not change the endpoint's response semantics
  (identical 401 preserved); the event is committed even though the request
  fails (explicit `db.commit()` in that branch — the only self-committing
  write site, since there is no successful mutation to piggyback on).

## Read APIs

**`GET /api/items/{item_id}/events`** (in `items.py`; member-readable like the
rest of items): events where `entity_type == "item" AND entity_id == item_id`,
`ORDER BY created_at DESC, id DESC`, `LIMIT 100`. 404 when the item doesn't
exist. Returns `list[AuditEventRead]`.

**`GET /api/audit`** (new router `backend/app/routers/audit.py`, prefix
`/api/audit`, **router-level `require_admin`**, registered in `main.py`'s
protected loop): query params `limit: int = 50` (max 200), `offset: int = 0`,
`q: str | None` (case-insensitive substring against `actor_name`,
`entity_label`, and `event_type`), `entity_type: str | None` (exact match).
`ORDER BY created_at DESC, id DESC`. Returns:

```python
class AuditPage(BaseModel):
    items: list[AuditEventRead]
    total: int   # count with the same filters, ignoring limit/offset
```

```python
class AuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    actor_name: str | None
    event_type: str
    entity_type: str
    entity_id: int | None
    entity_label: str | None
    field: str | None
    old_value: str | None
    new_value: str | None
```

## Frontend

**Types/client:** `AuditEvent` interface mirroring `AuditEventRead`
(`created_at: string`); `getItemEvents(itemId): Promise<AuditEvent[]>`;
`getAuditEvents(params: {limit?, offset?, q?, entity_type?}): Promise<{items: AuditEvent[]; total: number}>`.

**Drawer — Activity section** (`components/ItemActivity.tsx`, rendered by
`ItemDrawer` as the LAST section, label `Activity`): fetches
`getItemEvents(item.id)` on mount/item change. Row format, muted small text
(`text-xs text-gray-500`), newest first, scrollable container
(`max-h-64 overflow-y-auto`):

- header per row: `<actor_name ?? "System">` + `·` + localized timestamp
  (`new Date(created_at).toLocaleString()`)
- `item.created` → `created this item`
- `item.updated` → `changed <field>: <old ?? "—"> → <new ?? "—">`
- `link.added` → `added link <new_value>`; `link.removed` → `removed link <old_value>`
- anything else (future-proof) → the raw `event_type`
- empty state: `No activity yet.`

**Admin — Audit Log panel** (`components/admin/AuditLogSection.tsx`, rendered
full-width BELOW the Users panel, above Capacity): card chrome like Users
(icon 📜, `bg-indigo-50 text-indigo-600` accent, count pill shows `total`).
Controls row: text input placeholder `Filter by actor, entity, or event…`
(applies on change, resets offset) + entity-type `<select>` (`All types`,
`item`, `link`, `import`, `team`, `team_member`, `planning_interval`,
`capacity`, `lane`, `board`, `user`, `auth`). Table columns: **Time · Actor ·
Event · Entity · Change**; Entity cell = `entity_label` (+ ` #<entity_id>`
when present); Change cell = `field: old → new` when `field` set, else
`new_value ?? old_value ?? "—"`; Actor `—` when NULL. Footer: `Load more`
button while `items.length < total` (appends next offset page). Empty state:
`No audit events.`

## Testing

**Backend:** writer unit (`log_event` adds without committing; stringification;
None actor). Emission per surface: item update writes one row per changed
field with actor id+name and skips `position`; item delete cascades child
rows; link add writes two rows; import writes exactly ONE event; user update
redacts password and resolves team names; capacity upsert logs old→new;
auth login/failed/logout rows (failed: actor NULL, 401 body unchanged).
Read APIs: `/api/items/{id}/events` returns newest-first scoped rows (and 404
for unknown item); `/api/audit` — member 403, admin 200, `q` filter,
`entity_type` filter, limit/offset pagination + correct `total`.

**Frontend:** client fns hit the right URLs (query-string encoding);
`ItemActivity` renders created/updated/link rows + empty state;
`AuditLogSection` renders rows, filters trigger refetch with reset offset,
Load more appends; drawer renders the Activity section.

## Scope guards (v1)

- No retention/purge; no CSV export; no undo/restore from audit; no
  IP/user-agent capture; failed-login events unthrottled (rate limiting
  remains future work).
- Item `position` changes and derived `wsjf_score`/`cost_of_delay` are
  deliberately NOT logged.
- CSV import writes ONE summary event, not per-item events.
- Audit rows are append-only: no update/delete API for them exists.
