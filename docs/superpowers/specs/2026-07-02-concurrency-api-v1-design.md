# Concurrent Edit Safety + API Contract (/api/v1, locking, pagination) — Design

**Date:** 2026-07-02
**Status:** Approved (design); pending spec review
**Context:** P2 of the enterprise-hardening package (P1 reference integrity merged at 839de24;
P3 import safety and P4 timestamps + observability follow).

## Goal

Three API-contract hardenings in one coherent branch: (1) the one-time breaking
move of every resource route to **`/api/v1`** while there is exactly one
consumer; (2) **optimistic locking** on items so two people editing the same
card can no longer silently overwrite each other; (3) **pagination** on the
items collection using the contract `/api/audit` already established.

## 1. `/api/v1` prefix

Every resource router's prefix gains `/v1`:

| Router | New prefix |
|---|---|
| auth | `/api/v1/auth` |
| items | `/api/v1/items` |
| links (+ `/link-relations`) | `/api/v1` (routes `/links`, `/link-relations`) |
| imports | `/api/v1` (route `/import`) |
| teams | `/api/v1/teams` |
| team_members | `/api/v1/team-members` |
| planning_intervals | `/api/v1/planning-intervals` |
| capacities | `/api/v1/capacities` |
| boards (+ lanes) | `/api/v1` (routes `/boards`, `/lanes/...`) |
| users | `/api/v1/users` |
| audit | `/api/v1/audit` |
| comments | `/api/v1` (routes `/items/{id}/comments`, `/comments/{id}`) |

**`GET /api/health` stays unversioned** — it is an infrastructure probe; the
compose healthcheck and nginx (`location /api/` prefix-matches `/api/v1/`)
stay untouched.

Frontend: `client.ts` gets one exported constant

```ts
export const API = "/api/v1";
```

and every URL in the file templates off it (`` `${API}/items` `` …). The auth
fns (`login`/`logout`/`getMe`/`changePassword`) already live in client.ts and
inherit the constant — `AuthContext.tsx` needs no change. Backend tests update
their URL literals mechanically.

**Versioning policy (documented here, binding):** breaking API changes bump
the prefix (`/api/v2`), at which point `/api/v1` is frozen; until a second
consumer exists, frontend and backend continue to evolve `/v1` in lockstep
within a branch.

## 2. Optimistic locking on items

**Migration `0013_item_version` (`down_revision = "0012"`):**

```python
op.add_column(
    "items",
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
)
```

Downgrade drops the column. Per the migration process rule, the task dry-runs
`alembic upgrade head` + `downgrade 0012` against the compose Postgres.

**Model:** `version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")`
(placed after `position`).

**Schemas:** `ItemRead` (via `ItemBase` inheritance chain it is NOT part of
`ItemBase` — add `version: int` to `ItemRead` directly) and `ItemUpdate` gains
a **required** field `version: int` (the only required field there; keeps
`extra="forbid"`).

**`update_item`** (routers/items.py), before any mutation:

```python
changes = payload.model_dump(exclude_unset=True)
changes.pop("version")
if payload.version != item.version:
    raise HTTPException(
        status_code=409,
        detail="Item was modified by someone else — reload and retry",
    )
...apply changes as today...
item.version += 1
```

- The 409 happens before diffing/audit — a conflicted PATCH writes nothing.
- `version` is never in `ITEM_TRACKED_FIELDS` (no audit rows for it).
- Missing `version` in the payload → FastAPI 422 (required field).
- Scope: PATCH `/items/{id}` only. `create_item` starts at 1 (defaults);
  DELETE stays unversioned (deleting a stale item is still intentional);
  comments/links/master-data endpoints unchanged (master-data rename race
  stays bounded by unique constraints — deferred by design).

**Frontend:**

- `types.ts`: `Item` gains `version: number`; the update payload type gains
  required `version: number`.
- Every `updateItem` call site threads the current item's version into the
  patch: `ItemDrawer` save (one save path covers the field editors and WSJF
  toggles), `BoardView` drag, `StoryBoardModal`, `PlanningView`,
  `TimelineView` (whichever of these mutate items — call sites enumerated at
  plan time; all receive their `Item` objects from `listItems`/`getItem`,
  which now include `version`).
- Conflict handling via the existing `ConflictError`:
  - Drawer: error line (exact copy)
    `This item was changed by someone else — showing the latest version.`
    then refetch the item and swap the drawer's state to it (unsaved edits
    dropped — v1 trade-off, documented).
  - Board/other views: catch `ConflictError` → refetch the item list; the
    card visibly snaps back (that is the feedback).

## 3. Paginated `GET /api/v1/items`

Mirrors `/api/audit`'s contract and clamping style:

```python
class ItemPage(BaseModel):
    items: list[ItemRead]
    total: int
```

- Params: `limit: int = 200` (clamped to 1..1000), `offset: int = 0` (clamped
  to >= 0), plus the existing filters (`kind`, `status`, `planning_interval`,
  `leading_team`, `assignee`, `q`) unchanged.
- `total` = count under the same filters, ignoring limit/offset.
- Ordering `Item.position` unchanged.
- `GET /items/{id}` and everything else unchanged.

**Client hides the pagination** — consumers keep receiving `Item[]`:

```ts
export async function listItems(params: Record<string, string> = {}): Promise<Item[]> {
  const out: Item[] = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ ...params, limit: "500", offset: String(offset) }).toString();
    const page = await request<{ items: Item[]; total: number }>(`${API}/items?${qs}`);
    out.push(...page.items);
    if (out.length >= page.total || page.items.length === 0) return out;
    offset = out.length;
  }
}
```

The six consumers (BoardView, ItemDrawer, PlanningView, StoryBoardModal,
TimelineView, useBoard) are untouched by pagination.

## Testing

**Backend:** version mismatch → 409 with the exact detail and NO applied
changes/audit rows; success increments version by exactly 1 and version never
appears in audit; missing version → 422; pagination: limit/offset page math,
clamping, `total` respects filters; the bulk URL migration keeps every
existing test green under `/api/v1`.

**Frontend:** client fns hit `/api/v1/...`; `listItems` auto-paginates
(mock two pages, assert concatenation + loop termination); `updateItem`
callers send `version`; drawer conflict shows the exact copy and refetches;
board drag conflict refetches the list. Existing tests migrate mechanically
(client-fn mocks mostly shield them; fixtures gain `version: 1`).

## Scope guards (v1)

- No ETag/If-Match headers — the payload version is simpler for a same-origin SPA.
- No locking on comments, links, or master data.
- No field-level merge on conflict; the drawer drops unsaved edits after a 409.
- No pagination UI — the client absorbs it; views still load everything.
- `/api/health` unversioned; no `/api/v2` machinery beyond the documented policy.
