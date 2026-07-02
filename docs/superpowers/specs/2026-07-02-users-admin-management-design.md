# Users Admin Management — Editable Email / Password / Team + Table UX — Design

**Date:** 2026-07-02
**Status:** Approved (design); pending spec review

## Goal

Admins manage user accounts properly from the Admin page: change a user's
**email**, **password**, and **team membership**, in a **full-width table +
edit-modal** UI that scales past a handful of users. Accounts remain separate
from the assignee/capacity "Team Members" list (explicit decision — no
unification, one team per user).

## Backend

**Migration `0009_users_team` (`down_revision = "0008"`):**

```python
op.add_column("users", sa.Column(
    "team_id", sa.Integer,
    sa.ForeignKey("teams.id", ondelete="SET NULL"), nullable=True,
))
op.create_index("ix_users_team_id", "users", ["team_id"])
```

Downgrade drops the index then the column.

**Model (`models.py`, class `User`):** mirror `TeamMember.team_id` plus a
relationship and a read-through property so every endpoint that returns
`UserRead` (users router, `/api/auth/me`, `login`) resolves the team name
with zero router changes:

```python
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    team: Mapped["Team | None"] = relationship("Team")

    @property
    def team_name(self) -> str | None:
        return self.team.name if self.team else None
```

**Schemas:**

- `UserRead` gains `team_id: int | None = None` and `team_name: str | None = None`.
- `UserCreate` gains `team_id: int | None = None`.
- `UserUpdate` gains:
  - `email: str | None = Field(default=None, min_length=3, max_length=255)`
  - `team_id: int | None = None` — but since `exclude_unset` semantics must
    distinguish "not sent" from "clear the team", the router uses
    `"team_id" in changes` (from `model_dump(exclude_unset=True)`), so an
    explicit `"team_id": null` clears the team.

**Router `users.py` PATCH additions (existing guards unchanged):**

- `email` present → strip/lowercase; if another user (id != target) has that
  email case-insensitively → **409** `"Email already in use"`. No session
  revocation (sessions bind `user_id`).
- `team_id` present and not `None` → the team must exist, else **422**
  `"team_id does not exist"`.
- `POST` (create) validates `team_id` the same way.

**No other behavior changes:** self-lockout guard, password-reset and
deactivation session revocation, router-level `require_admin`, and the
no-DELETE rule all stay exactly as shipped.

## Frontend

**Types/client:** `AuthUser` gains **optional** `team_id?: number | null` and
`team_name?: string | null` — optional so existing typed test fixtures that
construct `AuthUser` literals keep compiling; the backend always sends both,
and consumers render `team_name ?? "—"`. `createUser` payload gains optional `team_id`; `updateUser`
payload gains optional `email` and `team_id: number | null`.

**`admin/UsersSection.tsx` becomes a full-width panel** (same filename,
rendered OUTSIDE the 3-card grid, between the grid and `CapacitySection` in
`AdminView`):

- Card chrome as today (`AdminCard`-style header: 👤 Users, rose accent,
  count pill) with a right-aligned `+ Add user` primary button.
- A table with columns **Name, Email, Team, Role, Status** + a per-row
  `Edit` button (`aria-label={"edit user " + display_name}`). Inactive
  users: name gray + line-through, Status shows `inactive` (amber pill)
  vs `active` (emerald pill). Team column shows `team_name ?? "—"`.
  Empty state row: "No users yet."
- The old inline create form and the `window.prompt` password reset are
  removed (modals replace them).

**`admin/UserModal.tsx` (new, one dumb component for both modes):**

```ts
{ mode: "create" } | { mode: "edit"; user: AuthUser }
+ { teams: Team[]; currentUserId: number; onSaved: () => void; onClose: () => void }
```

- Fields: Display name, Email, Team (`<select>`: "No team" + team names,
  value = team id), Role (`<select>`, **disabled in edit mode for the
  current user**), Active (checkbox, **hidden in edit mode for the current
  user**, absent in create mode), Password — labeled
  "Password" (create, required) / "New password (leave empty to keep)"
  (edit, optional).
- Save (create) → `createUser({email, display_name, password, role, team_id})`.
- Save (edit) → `updateUser(id, diff)` where diff contains **only changed
  fields** (email/display_name/role/team_id compared against the incoming
  user; password only when nonempty; is_active only when toggled).
- **Inline error handling** (deliberate upgrade over sibling sections): a
  rejected save renders the server detail in the modal (409 duplicate email,
  422 unknown team / short password) — parse the thrown Error's message for
  the detail text, fall back to "Could not save user."
- Modal chrome mirrors `UserMenu`'s password modal (backdrop click closes,
  `stopPropagation` on the card, Cancel button).
- Client-side guards mirror the server: create requires nonempty name/email
  and password ≥ 8 chars before enabling Save.

**`AdminView.tsx`:** grid keeps Teams/Team Members/Planning Intervals (3
cards); `<UsersSection currentUserId={user.id} />` moves to its own
full-width block below the grid, above Capacity. `UsersSection` fetches
`listUsers()` + `getTeams()` itself (it needs teams for the modal).

## Testing

**Backend (`test_api_users.py` additions):**

- PATCH email: persists lowercase, other fields untouched; duplicate of
  ANOTHER user (case-insensitive) → 409; PATCHing a user's own current email
  with different case → 200 (self-exclusion works).
- PATCH team: set → `team_id`/`team_name` in response; explicit `null`
  clears; unknown id → 422.
- POST with `team_id` → 201 with `team_name` resolved; POST with unknown
  `team_id` → 422.
- `/api/auth/me` includes `team_id`/`team_name` (property path through
  from_attributes).

**Frontend:**

- `UsersSection`: renders table rows with email/team/status; Edit opens the
  modal prefilled; empty state.
- `UserModal` (edit): changing email+team then Save calls `updateUser` with
  exactly `{email, team_id}`; rejected save shows inline error; password
  field empty → not in payload; role select disabled for `currentUserId`.
- `UserModal` (create): Save calls `createUser` with all fields incl.
  `team_id`; Save disabled until name/email/password valid.
- `AdminView` test: adjust for the moved section (still mocks `listUsers`,
  now also `getTeams`).

## Scope guards (v1)

- Accounts stay separate from Team Members; one team per user; no
  unification, no capacity/assignee impact, no CSV involvement.
- No self-service email change (admin page only; own password change stays
  in the header menu). No email verification. No user deletion.
- Sorting/search/pagination in the table: out of scope (order stays
  `display_name`).
