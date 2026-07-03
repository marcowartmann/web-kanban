# Item → Department Assignment — Design

**Date:** 2026-07-03
**Status:** Approved (design)

## Goal

Let **feature** and **story** items be assigned to **one** team department. The
department must belong to the item's `leading_team`. Builds on
[2026-07-03-team-departments-design.md].

## Data model

- New nullable **`Item.department_id`** FK → `team_departments.id`,
  `ON DELETE SET NULL`, indexed.
- Relationship `Item.department: TeamDepartment | None`.
- Read-only property `Item.department_name` → `self.department.name if self.department else None`.
- Schema:
  - `department_id: int | None = None` added to `ItemBase` (flows to `ItemCreate`
    and, via inheritance, `ItemRead`) and to `ItemUpdate`.
  - `department_name: str | None = None` added to `ItemRead`.
- Migration `0020` adds the column + FK + index; verified upgrade+downgrade on
  compose Postgres.

## Validation rule

A helper in the items router, mirroring `_check_container`:

```
_check_department(db, department_id, *, kind, leading_team)
```

Whenever `department_id` is being set to a non-null value, it enforces:
1. The department exists → else `422 "department_id does not exist"`.
2. The item `kind` is `feature` or `story` → else `422 "Department applies to features and stories only"`.
3. The department's team name equals `leading_team`
   (`department.team.name == leading_team`) → else
   `422 "Department must belong to the item's leading team"`. When
   `leading_team` is `None`, this fails (no department may be set).

Applied on **create** (using `payload.kind` / `payload.leading_team`) and on
**patch** (using `item.kind` — kind is immutable — and the resulting
`leading_team`: the patched value if present, else `item.leading_team`).

## Leading-team change clears an invalid department

Mirrors the existing container auto-clear. In `update_item`, after the
`_check_department` branch: if the patch does **not** set `department_id`, the
item currently has a `department_id`, the patch changes `leading_team`, and the
current department's team no longer matches the new `leading_team`, then set
`changes["department_id"] = None`. This preserves the invariant that a set
department always belongs to the leading team.

## Audit / tracking

`department_id` is included in the item's tracked-field change logging the same
way `container_id` is (old/new via `department_name` for readability where the
existing code resolves labels; otherwise the raw id through the standard
tracked-field path). No new event type.

## Frontend

### Types & data
- `Item` gains `department_id: number | null` and `department_name: string | null`.
- `App` loads departments once via `getDepartments()` (already exists) and passes
  a `departments: Department[]` prop into `ItemDrawer` (alongside `containers`).

### `ItemDrawer`
- For `feature`/`story` items, render a **Department** `SearchableSelect` near the
  leading-team field.
- Options: departments whose `team_name` equals the item's current draft
  `leading_team`. If `leading_team` is empty, the field is disabled with a hint
  ("Set a leading team first"). Selecting `null` clears it.
- The selection is part of the existing drawer draft and is persisted through the
  current `updateItem({ ...draft, version })` save flow as `department_id`.
- The field is **not** rendered for risk items.
- When the leading team changes in the drawer, the department options refilter;
  a now-invalid selection is cleared client-side to match the server behavior
  (and the server clears it authoritatively regardless).

## Testing

### Backend (`tests/test_api_items.py` or a new `test_api_item_department.py`)
- Create a feature with a department of its leading team → `201`, persisted.
- Patch a story's `department_id` to a matching-team department → `200`.
- `422` when the department's team ≠ the item's leading team.
- `422` when assigning a department to a risk item.
- `422` when `leading_team` is null and a department is provided.
- Patching `leading_team` to a different team clears a now-invalid `department_id`.
- `department_name` present in `ItemRead`.

### Frontend (`ItemDrawer` tests)
- Department field renders for a feature/story and lists only departments of the
  item's leading team.
- Field is absent for a risk item.
- Changing the department includes `department_id` in the `updateItem` payload.

## Out of scope

- Filtering the board or ranking by department.
- Showing department on cards.
- Multi-department assignment (single `department_id` only).

## Files touched (anticipated)

- `backend/app/models.py` — `Item.department_id`, relationship, `department_name`.
- `backend/alembic/versions/0020_item_department.py` — migration.
- `backend/app/schemas.py` — `ItemBase.department_id`, `ItemUpdate.department_id`, `ItemRead.department_name`.
- `backend/app/routers/items.py` — `_check_department`, create/patch wiring, auto-clear.
- `backend/tests/test_api_item_department.py` — new.
- `frontend/src/types.ts` — `Item.department_id`, `Item.department_name`.
- `frontend/src/App.tsx` — load + pass departments to `ItemDrawer`.
- `frontend/src/components/ItemDrawer.tsx` — Department field.
- `frontend/src/components/ItemDrawer*.test.tsx` — coverage.
