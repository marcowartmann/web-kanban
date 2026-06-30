# Team Members + Teams Admin, Assignee Dropdown — Design

**Date:** 2026-06-30
**Status:** Approved (pending spec review)

## 1. Purpose

Make the item **Assignee** a strict searchable dropdown of globally-configured
**Team Members**, and add an **Admin** area in the UI to manage **Teams** and **Team
Members**. Seed the lists from data already present on import.

## 2. Scope

In scope:
- New `teams` and `team_members` tables + CRUD API.
- An Admin view in the app (Board ⇄ Admin nav) with a Teams section and a Team Members
  section (add / remove).
- A reusable strict `SearchableSelect` (combobox) used for the drawer's Assignee field.
- Idempotent seeding of teams + members on CSV import.

Out of scope:
- Wiring items' `Leading Team` / `Supporting Team` fields to configured Teams (stays free
  text; revisit later).
- Auth / per-user permissions (single-user tool).
- Renaming/editing teams or members (add + remove only for v1).

## 3. Data model (new)

- **`teams`**: `id` (int PK), `name` (String, **unique**, not null), `created_at`.
- **`team_members`**: `id` (int PK), `name` (String, **unique**, not null),
  `team_id` (FK → `teams.id`, nullable, **`ON DELETE SET NULL`**), `created_at`.
- Item `assignee` **remains a free-text name** (unchanged). The dropdown writes the chosen
  member's name into `assignee`; member rows and items stay decoupled (renaming/removing a
  member never rewrites items, and CSV import keeps working).
- Alembic migration `0002_teams_team_members`.

## 4. Backend API

```
GET    /api/teams                 list (sorted by name)
POST   /api/teams                 {name} -> 409 on duplicate
DELETE /api/teams/{id}            404 if missing; members' team_id set NULL (FK)

GET    /api/team-members          list (sorted by name), each with team_id + team_name
POST   /api/team-members          {name, team_id?} -> 422 if team_id missing-ref, 409 dup
DELETE /api/team-members/{id}     404 if missing
```

Schemas: `TeamCreate{name}`, `TeamRead{id,name}`, `TeamMemberCreate{name, team_id?}`,
`TeamMemberRead{id, name, team_id, team_name}`.

### 4.1 Seeding on import (idempotent, additive)

In `replace_all` (after items are inserted), within the same transaction:
- Collect distinct non-empty `assignee` values across imported items → **get-or-create** a
  `TeamMember(name=...)` for each (team_id null).
- Collect distinct team tokens from `leading_team` and `supporting_team` (the latter split
  on commas, trimmed, non-empty) → **get-or-create** a `Team(name=...)` for each.
- **Never deletes** existing teams/members, so admin-configured entries survive re-imports.

`ImportResult` is unchanged (still reports feature/story/risk counts + warnings).

## 5. Frontend

### 5.1 Types + client (`types.ts`, `api/client.ts`)
- `Team{ id, name }`, `TeamMember{ id, name, team_id: number|null, team_name: string|null }`.
- `getTeams`, `createTeam(name)`, `deleteTeam(id)`, `getTeamMembers`,
  `createTeamMember({name, team_id?})`, `deleteTeamMember(id)`.

### 5.2 `SearchableSelect.tsx` (strict combobox, reusable)
- Props: `{ value: string | null; options: string[]; onChange: (v: string | null) => void;
  placeholder?: string }`.
- Behavior: an input filters `options` as you type; a dropdown lists matches; clicking a
  match commits it via `onChange`. **Strict:** typing a non-matching value does not commit
  (on blur the input reverts to `value`). A clear (×) sets `onChange(null)`. If `value`
  isn't in `options` (legacy assignee), it's still shown as the current text but only
  options are selectable.
- Accessible: input is a `combobox`/textbox; options are buttons in a listbox.

### 5.3 Admin view (`components/admin/AdminView.tsx`, `TeamsSection.tsx`, `TeamMembersSection.tsx`)
- **TeamsSection**: lists teams; an add row (name input + Add); each row has a remove (×).
- **TeamMembersSection**: lists members (name + team); an add row (name input + team
  `<select>` of teams + Add); each row has a remove (×). Shows the member's team name.
- Each mutation calls the API then refreshes via the shared `onChanged` handler.

### 5.4 `App.tsx`
- Add `view: "board" | "admin"` state and header nav buttons **Board | Admin** (active
  highlighted). Board-only actions (Import, New) show only on the board view.
- Hold `teamMembers` state, fetched on mount and on `refreshKey` change; pass the member
  **names** to `ItemDrawer`. Admin mutations bump `refreshKey`, refreshing the list.

### 5.5 `ItemDrawer.tsx`
- Replace the Assignee `Field` with `SearchableSelect` (options = team member names,
  `value` = current `assignee`, `onChange` → `set("assignee", v ?? "")`). Applies to all
  item kinds (shared drawer).

## 6. Testing

- **Backend:** team CRUD (create/list/delete, dup → 409, missing → 404); team-member CRUD
  (create with/without team, list includes `team_name`, bad `team_id` → 422); delete-team
  sets members' `team_id` NULL; import seeds members from the fixture's assignees (e.g.
  "Marco Wartmann") and teams from leading/supporting values; re-import does not duplicate;
  a manually-added member survives a re-import.
- **Frontend:** `SearchableSelect` (filter, click-select commits, clear sets null, non-match
  typing doesn't commit); `TeamsSection`/`TeamMembersSection` add+remove call the right API;
  `ItemDrawer` renders the Assignee dropdown and selecting a member updates the draft.
- **Verify:** Docker stack rebuild + Playwright — open Admin, add a team + member, then on a
  card's drawer pick the member from the Assignee dropdown and Save.

## 7. Migration / compatibility notes

- New tables only; no change to `items`. Existing data unaffected.
- Strict dropdown + seeded members means imported assignees are immediately selectable;
  any legacy assignee not seeded still displays but must be added to be re-selectable.
