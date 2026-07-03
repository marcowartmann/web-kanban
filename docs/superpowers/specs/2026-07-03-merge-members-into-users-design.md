# Merge Team Members into Users — Design

**Date:** 2026-07-03
**Status:** Approved (design); pending spec review
**Context:** Follows the enterprise-hardening package (P1-P4 merged; main at 3ae9b92).
User decisions: items move to an **assignee FK now**; people without accounts exist as
**users with nullable email**.

## Problem

Two disjoint person entities: `users` (login accounts: email, role, team) and
`team_members` (name-only rows used for assignment and capacity). The same human
appears in both; `items.assignee` is a plain string kept consistent only by P1's
rename-propagation machinery, and capacities hang off `team_members`. One person
entity should serve login, assignment, and capacity.

## Outcome

- `User` is the single person entity. `team_members` (table, router, admin section,
  schemas, client fns, types) is deleted.
- People who cannot log in are users with `email = NULL, password_hash = NULL`
  (upgradeable later by setting email + password).
- `items.assignee` (string) is replaced by `items.assignee_id` FK → users
  (`ON DELETE SET NULL`); reads still serve the display name. Names now live in one
  place, so P1's member-rename propagation is deleted (teams/planning intervals keep
  theirs — they stay string-identified on items, out of scope).
- `capacities.member_id` becomes `capacities.user_id` FK → users (`CASCADE`).

## 1. Migration `0015_merge_members_into_users` (`down_revision = "0014"`, data-bearing)

Runs in one transaction on PG. Ordered steps:

1. `users.email` → nullable (`op.alter_column(..., existing_type=sa.String(255), nullable=True)`).
   The unique constraint stays — multiple NULLs are allowed on PG and SQLite.
2. **Member merge.** For each `team_members` row, resolve a user:
   - exact `display_name == name` match → that user (ties broken by lowest user id);
     the user inherits the member's `team_id` **only if the user's is NULL**;
   - no match → INSERT a login-less user: `email NULL, display_name = name,
     password_hash NULL, role 'member', is_active true, auth_provider 'local',
     team_id = member.team_id`.
   Keep the member_id → user_id mapping for steps 3-4.
3. **Items.** `ADD COLUMN assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL`
   + index `ix_items_assignee_id`. Backfill: each distinct non-empty (stripped)
   `items.assignee` string resolves through the step-2 name rules — matching no user
   creates another login-less user (`team_id NULL`) so no assignment is lost. Then
   drop `ix_items_assignee` (created by 0012) and the `assignee` column.
4. **Capacities.** Add `user_id` FK → users `ON DELETE CASCADE`; backfill via the
   mapping; drop the old unique constraint `uq_capacity_member_pi_iter` and
   `member_id`; create `uq_capacity_user_pi_iter (user_id, planning_interval, iteration)`.
5. Drop `team_members`.

Downgrade is **best-effort** (merged members cannot be un-merged): recreate
`team_members` from users that hold capacities or item assignments or have
`email IS NULL`; restore `items.assignee` (display-name join) and
`capacities.member_id` via the recreated rows; then DELETE the login-less
(`email IS NULL`) users and restore the email NOT NULL constraint. Users that were
merged in step 2 keep any inherited team_id (not reversed) — documented. The standing
rule applies: dry-run upgrade + downgrade + re-upgrade against compose Postgres,
**plus a seeded rehearsal** (see Testing).

## 2. Models

- `User.email: Mapped[str | None]` (comment: stored lowercase; NULL = cannot log in).
- `Item`: `assignee` column deleted; add
  `assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)`
  and `assignee_user: Mapped["User | None"] = relationship()` plus
  `@property assignee -> str | None` returning `self.assignee_user.display_name if ... else None`
  (keeps `ItemRead.assignee` serialization and audit label code working).
- `Capacity.member_id` → `user_id` FK users CASCADE; unique constraint renamed as in
  the migration.
- `TeamMember` class and `Team.members` relationship deleted.

## 3. API

### Items

- `ItemRead`: keeps `assignee: str | None` (display name via the property) and gains
  `assignee_id: int | None`. The list endpoint eager-loads the relationship
  (`selectinload(Item.assignee_user)`) so paginated serialization does not N+1.
- `ItemCreate` / `ItemUpdate`: `assignee` field replaced by `assignee_id: int | None`
  (`extra="forbid"` rejects old payloads). Unknown id → 422 `"assignee_id does not exist"`
  (mirrors the team_id pattern in users). Explicit null clears the assignment.
- List filter: `assignee: str | None` query param replaced by `assignee_id: int | None`
  (v1 lockstep policy).
- Audit: `ITEM_TRACKED_FIELDS` swaps `"assignee"` for `"assignee_id"` internally, but
  the logged event keeps `field="assignee"` with old/new **display names** (resolved
  at diff time; None when unassigned). `version` handling untouched.

### Users

- `UserRead.email: str | None`.
- `UserCreate`: `email` and `password` both optional; rule: **password requires
  email** → 422 `"Password requires an email"`. Email-without-password is allowed
  (cannot log in until a password is set). Duplicate-email check only when email is
  provided. Audit `entity_label = email or display_name`.
- `UserUpdate`: setting `email: null` explicitly clears it, but only when the account
  has no password → 422 `"Remove the password first"` otherwise. (Today an explicit
  null is silently ignored; `exclude_unset` distinguishes "not sent".) Duplicate check
  only for non-null emails.
- **New `DELETE /api/v1/users/{user_id}`** (admin):
  - self-delete → 422 `"Admins cannot delete themselves"`;
  - user has comments → 409 `"User '<display_name>' has <n> comments — deactivate instead"`
    (**no force** — comment authorship is history; `comments.author_id` has no
    ON DELETE and must stay valid);
  - assigned items and no force → 409 `"User '<display_name>' is assigned to <n> items"`;
    with `?force=true` the FK nulls the assignments;
  - otherwise delete; sessions and capacities cascade; audit `user.deleted`
    (`entity_label = email or display_name`).
- **New `GET /api/v1/users/options`** (require_user — the full `/users` list stays
  admin-only): `[{id, display_name}]` ordered by display_name, for assignee/capacity
  dropdowns. Mechanically: the users router drops its router-level
  `dependencies=[Depends(require_admin)]`; every existing endpoint gains
  `Depends(require_admin)` individually; `/options` alone uses `require_user`.
  Route order: `/options` is declared before `/{user_id}` routes.

### Capacities

- `CapacityUpsert.member_id` → `user_id`; validation message 422 `"user_id does not exist"`.
- `CapacityRead.member_id` → `user_id`.
- Audit label: `f"{user.display_name} · {pi} · I{iteration}"` (same shape, user-sourced).

### Import (P3 seam)

- CSV still carries assignee **names**. `replace_all` resolves each non-empty stripped
  assignee name → user (exact display_name match, ties lowest id) or creates a
  login-less user, then sets `assignee_id` on the inserted items.
- `_seed_teams_and_members` becomes `_seed_teams_and_users` (teams unchanged; users
  instead of members). Import preview counts unchanged.

### Snapshots (P3 seam)

- Snapshots automatically include `assignee_id` via the generic column walk. Restore adds an
  assignee-repair rule mirroring the comment rules: `assignee_id`s pointing at users
  that no longer exist are nulled with warning
  `f"Cleared assignee for {n} item(s) whose user no longer exists"` (emitted once,
  only when n > 0).
- Legacy snapshots (pre-merge: string `assignee` key, no `assignee_id`) restore with
  all items unassigned plus one warning `"Legacy snapshot: assignee names were not restored"`
  (detected by any item row containing an `assignee` key).

### Auth

- Login queries by email — NULL emails never match; no other change. change-password
  and sessions are unreachable for login-less users by construction.

## 4. Frontend

- `types.ts`: `TeamMember` deleted → `PersonOption { id: number; display_name: string }`;
  `Item.assignee` stays (read-only display), `Item` gains `assignee_id: number | null`;
  `ItemUpdate` swaps `assignee` for `assignee_id`; `User.email: string | null`;
  `Capacity.member_id` → `user_id`.
- `client.ts`: `getTeamMembers`/`createTeamMember`/`renameTeamMember`/`deleteTeamMember`
  deleted → `getPersonOptions(): Promise<PersonOption[]>` (`GET ${API}/users/options`),
  `deleteUser(id, force = false)`. `upsertCapacity` payload uses `user_id`.
- **ItemDrawer**: `assigneeOptions` prop becomes `people: PersonOption[]`;
  `SearchableSelect` stays string-based — the drawer maps at its edge: options =
  `people.map(p => p.display_name)`, value = the current assignment's display name,
  onChange resolves name → id into `draft.assignee_id` (null on clear). Duplicate
  display names are ambiguous in this select — accepted, documented (member names were
  historically unique).
- **App**: loads `getPersonOptions()` once for the drawer; the board's Person filter
  keeps deriving its options from loaded items' `assignee` strings and keeps filtering
  client-side (unchanged behavior).
- **PlanningView / CapacitySection / lib/capacity.ts**: re-key from member to user
  (`user_id`), people list from `getPersonOptions()`; capacity math unchanged.
- **Admin**: `TeamMembersSection(.test)` deleted from AdminView. **UsersSection is the
  person manager**: "Add person" path (display_name + team only) alongside the
  existing full-user modal (email/password optional there); login-less users show "—"
  in the email column; row Delete button with the P1 idiom
  (`ConflictError` → `window.confirm(`${e.detail} Delete anyway?`)` → force retry) —
  except the comments-409, which is surfaced as a plain error (no confirm, since force
  is not accepted).

## Testing

- **Migration rehearsal (task step, compose PG):** seed a member+user name match, a
  member-only person, an item with an assignee string matching nobody, and capacities;
  upgrade; assert the mapping (merged user keeps email/team rules, login-less users
  created, `assignee_id` backfilled, capacities remapped, `team_members` gone);
  downgrade best-effort; re-upgrade; restore head. Value-level checks via psql.
- **Backend:** person-only creation rules (password-requires-email, email-clear rule);
  delete guards (self / comments-no-force / items-force) + cascade assertions +
  `user.deleted` audit; options endpoint member-accessible while `/users` stays 403;
  `assignee_id` write validation, null-clear, list filter, audit-by-name; import
  resolves/creates users and sets `assignee_id`; snapshot restore clears dangling
  assignees with the exact warning; legacy-snapshot warning.
- **Frontend:** drawer id-mapping (select a person → PATCH carries `assignee_id`),
  UsersSection person add/delete flows, capacity re-keying, deleted member client fns
  gone from tests. Fixture sweep: `assignee` string fixtures gain `assignee_id`.
- Baselines at spec time: backend 202, frontend 192 (exact counts pinned at plan time).

## Scope guards (v1)

- Teams and planning intervals remain string-identified on items (their P1 propagation
  machinery stays).
- No email invites, no IdP, no self-service profile editing.
- No assignee multi-select; one assignee per item as today.
- Historical `team_member.*` audit rows remain unchanged (event types simply stop
  being produced).
- Person filter stays client-side over loaded items (no new server filter semantics
  beyond the `assignee_id` param swap).

## Deployment note

0015 rewrites real data (items, capacities, users, members). It is transactional on
PG, but before the deploy-task rebuild, take a manual JSON dump of `users`,
`team_members`, `capacities`, and `items` via a scratch script into the snapshots
volume (the P3 snapshot format only covers items/comments/links) — recovery artifact
only, not wired into the app.
