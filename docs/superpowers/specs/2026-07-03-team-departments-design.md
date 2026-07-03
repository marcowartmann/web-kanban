# Team Departments — Design

**Date:** 2026-07-03
**Status:** Approved (design)

## Goal

Add **team departments**: specialized sub-teams nested under a `Team`. A user can
belong to **0..n** departments, of **any** team (independent of their primary
`team_id`). Departments and their memberships are managed from the Admin UI —
from both the department side and the user side.

## Data model

- New **`TeamDepartment`** (`team_departments`):
  - `id` PK
  - `name` (String 128)
  - `team_id` FK → `teams.id` `ON DELETE CASCADE`, indexed
  - `created_at`
  - Unique `(team_id, name)` — two teams may each have a "Frontend" department.
- New join **`user_team_departments`**:
  - `user_id` FK → `users.id` `ON DELETE CASCADE`
  - `department_id` FK → `team_departments.id` `ON DELETE CASCADE`
  - Composite PK `(user_id, department_id)`.
- `User.team_id` (primary team) is unchanged; departments are additive and not
  constrained to the user's own team.
- SQLAlchemy relationships:
  - `TeamDepartment.members: list[User]` via `secondary="user_team_departments"`.
  - `User.departments: list[TeamDepartment]` via the same secondary.
  - Use `cascade`/`passive_deletes` appropriately so the ORM matches the DB
    `ON DELETE CASCADE` and does not emit orphan updates.
- Cascades: deleting a team removes its departments and their membership rows;
  deleting a department or a user removes the relevant membership rows.

## API

New router `app/routers/departments.py`, mounted under the admin-protected set.
All endpoints require admin.

- `GET /api/v1/departments` → `list[DepartmentRead]` where `DepartmentRead` is
  `{id, name, team_id, team_name, member_ids: list[int]}`. One call feeds both
  the Teams view (filter by `team_id`) and the user editor picker.
- `POST /api/v1/departments` `{name, team_id}` → `201 DepartmentRead`.
  - `422` if `team_id` does not exist.
  - `409` if `(team_id, name)` already exists.
- `PATCH /api/v1/departments/{id}` `{name}` → `200 DepartmentRead`.
  - `404` if missing; `409` on duplicate name within the same team.
- `DELETE /api/v1/departments/{id}` → `204`. `404` if missing.
- `PUT /api/v1/departments/{id}/members` `{user_ids: list[int]}` → `200
  DepartmentRead`. Replaces the member set. `422` if any user id is unknown.
- `PUT /api/v1/users/{id}/departments` `{department_ids: list[int]}` → `200
  UserRead`. Replaces the user's department set. `422` if any department id is
  unknown. Lives in the existing users router.

`UserRead` gains `department_ids: list[int]` (default `[]`) so the editor can
preselect. `UserCreate`/`UserUpdate` are unchanged — departments are managed only
through the two `PUT` endpoints, keeping the join orthogonal to user create/edit.

Audit: emit `department.created` / `department.updated` / `department.deleted`
and a `department.members_changed` / `user.departments_changed` event on the
membership PUTs, following the existing `log_event` pattern.

## Frontend

### Client (`api/client.ts`)
- `Department` type `{ id; name; team_id; team_name; member_ids: number[] }`.
- `getDepartments()`, `createDepartment(name, teamId)`, `renameDepartment(id, name)`,
  `deleteDepartment(id)`, `setDepartmentMembers(id, userIds)`,
  `setUserDepartments(userId, departmentIds)`.
- `AuthUser` gains `department_ids?: number[]`.

### `DepartmentsSection` (new, `components/admin/DepartmentsSection.tsx`)
- Rendered **inside the existing "Teams & Capacity" admin section**, stacked below
  `TeamsSection` and above/below `CapacitySection`.
- Lists departments grouped by team. Per team: an inline add-department input.
- Per department row: rename, delete (with confirm), and a **members**
  multi-select (checkbox list of all users, showing display name) that calls
  `setDepartmentMembers`.
- Reuses `AdminCard` and the shared admin row/input/button classes for
  visual consistency.

### User editor (`components/admin/UserModal.tsx`)
- Add a **Departments** field: a checkbox list grouped by team, seeded from the
  user's `department_ids`.
- On save:
  - **edit:** if the selection changed, call `setUserDepartments(user.id, ids)`
    (in addition to the existing `updateUser` diff, only when non-empty).
  - **create:** after `createUser` resolves, if any departments are selected call
    `setUserDepartments(newUser.id, ids)`.
- The modal fetches the department list (via a prop passed from `UsersSection`,
  which loads `getDepartments()` once) to render the picker.

## Testing

### Backend
- **Migration:** upgrade **and** downgrade against compose Postgres (project
  rule); assert both tables and the unique constraint appear/disappear.
- **Models:** department roundtrip; membership add/remove; `(team_id, name)`
  uniqueness.
- **Departments API** (`tests/test_api_departments.py`): create (+`409` dup,
  `422` bad team), rename, delete, list shape with `member_ids`,
  `PUT members` replace (+`422` unknown user), admin-gating (`403` for member).
- **User departments:** `PUT /users/{id}/departments` replaces set (+`422`
  unknown dept); `UserRead.department_ids` reflects membership.
- **Cascades:** deleting a team removes its departments + memberships; deleting a
  user or department removes membership rows.

### Frontend
- `DepartmentsSection`: renders departments grouped by team; create/rename/delete
  call the right client fns; toggling a member calls `setDepartmentMembers` with
  the updated id set.
- `UserModal`: renders the departments checkbox list from a prop; editing the
  selection and saving calls `setUserDepartments` with the chosen ids; create
  flow calls it after `createUser`.
- Client unit coverage for the new functions' URLs/payloads.

## Out of scope

- Wiring departments into items, capacity, or ranking permissions.
- Non-admin visibility of departments.
- Per-department capacity or roles.

## Files touched (anticipated)

- `backend/app/models.py` — `TeamDepartment`, `user_team_departments`, relationships.
- `backend/alembic/versions/0019_team_departments.py` — migration.
- `backend/app/schemas.py` — `DepartmentRead`, `DepartmentCreate`, `DepartmentRename`,
  member/department set requests; `UserRead.department_ids`.
- `backend/app/routers/departments.py` — new router.
- `backend/app/routers/users.py` — `PUT /{id}/departments`; include `department_ids` in reads.
- `backend/app/main.py` — mount the departments router.
- `backend/tests/test_api_departments.py`, `test_api_users.py`, model/migration tests.
- `frontend/src/types.ts` — `Department`; `AuthUser.department_ids`.
- `frontend/src/api/client.ts` — department client fns.
- `frontend/src/components/admin/DepartmentsSection.tsx` — new.
- `frontend/src/components/admin/AdminView.tsx` — render `DepartmentsSection` in the teams section.
- `frontend/src/components/admin/UsersSection.tsx` — load departments, pass to modal.
- `frontend/src/components/admin/UserModal.tsx` — departments multi-select.
- Frontend tests for the above.
