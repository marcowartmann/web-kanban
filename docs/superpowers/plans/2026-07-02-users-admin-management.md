# Users Admin Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can change a user's email, password, and team membership from a full-width Users table with create/edit modals.

**Architecture:** Migration `0009` adds nullable `users.team_id` (FK → teams, SET NULL, indexed); a `team_name` property on the `User` model flows the team into every `UserRead` response (users router, `/api/auth/me`, `login`) with zero router-response changes. `PATCH /api/users/{id}` gains `email` (409 on duplicate excluding self) and `team_id` (explicit null clears; unknown → 422). The frontend replaces the cramped Users card with a full-width table + one `UserModal` component (create/edit) that submits only changed fields and surfaces server errors inline.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic (backend); React 18 + TS + Tailwind + vitest (frontend); Docker Compose.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-users-admin-management-design.md`. Branch `feat/users-admin-mgmt` off `main`.
- Migration `0009_users_team.py`, `revision = "0009"`, `down_revision = "0008"`; column `users.team_id` Integer NULLABLE, FK `teams.id` `ondelete="SET NULL"`, index `ix_users_team_id`.
- `User.team` relationship has NO `back_populates` (`Team.members` already back-populates `TeamMember.team`); `team_name` is a read-only Python property.
- Errors verbatim: 409 `"Email already in use"`, 422 `"team_id does not exist"`. Emails stored `strip().lower()`; duplicate check case-insensitive and MUST exclude the target user (`User.id != user.id`).
- `UserUpdate.team_id` uses exclude_unset semantics: the router distinguishes "not sent" from explicit `null` via `"team_id" in changes`.
- All shipped guards stay byte-identical: self-lockout (role/is_active), password-reset + deactivation revoke sessions, router-level `require_admin`, no DELETE route.
- `AuthUser` gains OPTIONAL `team_id?: number | null` and `team_name?: string | null` (existing typed fixtures must keep compiling).
- ENV NOTE (backend tasks): container does NOT bind-mount backend code; before pytest:
  `docker compose exec -T backend sh -c 'rm -rf /app/app /app/alembic /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/alembic backend:/app/alembic && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend pip install -q "pytest>=8.2" "httpx>=0.27" "bcrypt>=4.1"`
- KNOWN OUTAGE: `docker compose build frontend` may fail with `DeadlineExceeded` (Docker Hub proxy outage). Fallback deploy: `cd frontend && npm run build`, then `docker compose exec -T frontend sh -c 'rm -rf /usr/share/nginx/html/*' && docker compose cp frontend/dist/. frontend:/usr/share/nginx/html/`.

---

### Task 1: Migration `0009` + `User.team_id`/`team`/`team_name`

**Files:**
- Modify: `backend/app/models.py` (class `User`)
- Create: `backend/alembic/versions/0009_users_team.py`
- Test: `backend/tests/test_auth_models.py` (append)

**Interfaces:**
- Produces: `User.team_id: int | None`, `User.team: Team | None` (relationship), `User.team_name: str | None` (property). Tasks 2+ rely on all three.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_auth_models.py`:

```python
def test_user_team_relationship_and_name(db_session):
    from app.models import Team

    team = Team(name="Network")
    db_session.add(team)
    db_session.commit()

    user = User(email="t@x.ch", display_name="T", password_hash=None, team_id=team.id)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert user.team_name == "Network"

    loner = User(email="n@x.ch", display_name="N", password_hash=None)
    db_session.add(loner)
    db_session.commit()
    assert loner.team_name is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/tests' && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_auth_models.py -q`
Expected: FAIL — `TypeError: 'team_id' is an invalid keyword argument for User`.

- [ ] **Step 3: Extend the model**

In `backend/app/models.py`, class `User`, insert between the `auth_provider` and `created_at` lines:

```python
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
```

and append after `created_at` (inside the class):

```python
    # No back_populates: Team.members already pairs with TeamMember.team.
    team: Mapped["Team | None"] = relationship()

    @property
    def team_name(self) -> str | None:
        return self.team.name if self.team else None
```

(`ForeignKey`, `relationship`, `Mapped`, `mapped_column` are already imported.)

- [ ] **Step 4: Create the migration**

Create `backend/alembic/versions/0009_users_team.py`:

```python
"""users get a team

Revision ID: 0009
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "team_id",
            sa.Integer,
            sa.ForeignKey("teams.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_users_team_id", "users", ["team_id"])


def downgrade() -> None:
    op.drop_index("ix_users_team_id", table_name="users")
    op.drop_column("users", "team_id")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/app /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_auth_models.py -q`
Expected: PASS (3 passed).

- [ ] **Step 6: Apply the migration on Postgres**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/alembic' && docker compose cp ./backend/alembic backend:/app/alembic && docker compose exec -T backend alembic upgrade head && docker compose exec -T backend alembic current`
Expected: `0009 (head)`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/alembic/versions/0009_users_team.py backend/tests/test_auth_models.py
git commit -m "feat(backend): users get a team (migration 0009, model + team_name property)"
```

---

### Task 2: Schemas + users router — editable email & team

**Files:**
- Modify: `backend/app/schemas.py` (`UserRead`, `UserCreate`, `UserUpdate`)
- Modify: `backend/app/routers/users.py`
- Test: `backend/tests/test_api_users.py` (append), `backend/tests/test_api_auth.py` (append)

**Interfaces:**
- Consumes: `User.team_id`/`team_name` (Task 1).
- Produces: `UserRead {…, team_id, team_name}`; `UserCreate {…, team_id?}`; `UserUpdate {…, email?, team_id?}`; PATCH semantics per Global Constraints. Tasks 3–4 rely on these payload shapes.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_api_users.py`:

```python
def test_patch_email_change_dupe_and_self_exclusion(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    other = _seed(db_session, "other@x.ch")
    _as(admin)
    resp = anon_client.patch(f"/api/users/{other.id}", json={"email": "New@Mail.CH"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "new@mail.ch"

    dupe = anon_client.patch(f"/api/users/{other.id}", json={"email": "Admin@X.ch"})
    assert dupe.status_code == 409

    same = anon_client.patch(f"/api/users/{other.id}", json={"email": "NEW@mail.ch"})
    assert same.status_code == 200  # own address in different case — self-exclusion


def test_patch_team_set_clear_invalid(anon_client, db_session):
    from app.models import Team

    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")
    team = Team(name="Network")
    db_session.add(team)
    db_session.commit()
    _as(admin)

    set_resp = anon_client.patch(f"/api/users/{member.id}", json={"team_id": team.id})
    assert set_resp.status_code == 200
    assert set_resp.json()["team_id"] == team.id
    assert set_resp.json()["team_name"] == "Network"

    clear = anon_client.patch(f"/api/users/{member.id}", json={"team_id": None})
    assert clear.status_code == 200
    assert clear.json()["team_id"] is None
    assert clear.json()["team_name"] is None

    bad = anon_client.patch(f"/api/users/{member.id}", json={"team_id": 999})
    assert bad.status_code == 422


def test_create_with_team(anon_client, db_session):
    from app.models import Team

    admin = _seed(db_session, "admin@x.ch", role="admin")
    team = Team(name="Cloud")
    db_session.add(team)
    db_session.commit()
    _as(admin)

    created = anon_client.post(
        "/api/users",
        json={
            "email": "u@x.ch",
            "display_name": "U",
            "password": "longenough1",
            "role": "member",
            "team_id": team.id,
        },
    )
    assert created.status_code == 201
    assert created.json()["team_name"] == "Cloud"

    bad = anon_client.post(
        "/api/users",
        json={
            "email": "v@x.ch",
            "display_name": "V",
            "password": "longenough1",
            "role": "member",
            "team_id": 999,
        },
    )
    assert bad.status_code == 422
```

Append to `backend/tests/test_api_auth.py`:

```python
def test_me_includes_team(anon_client, db_session):
    from app.models import Team

    team = Team(name="Network")
    db_session.add(team)
    db_session.commit()
    user = _seed_user(db_session)
    user.team_id = team.id
    db_session.commit()

    anon_client.post("/api/auth/login", json={"email": "marco@x.ch", "password": "secret123"})
    body = anon_client.get("/api/auth/me").json()
    assert body["team_id"] == team.id
    assert body["team_name"] == "Network"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/tests' && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_users.py tests/test_api_auth.py -q`
Expected: FAIL — `team_id`/`team_name` missing from responses; email PATCH ignored (not in schema).

- [ ] **Step 3: Extend the schemas**

In `backend/app/schemas.py`:

`UserRead` — add after `is_active: bool`:

```python
    team_id: int | None = None
    team_name: str | None = None
```

`UserCreate` — add after `role: ...`:

```python
    team_id: int | None = None
```

`UserUpdate` — add after `display_name: ...`:

```python
    email: str | None = Field(default=None, min_length=3, max_length=255)
    team_id: int | None = None
```

- [ ] **Step 4: Extend the router**

In `backend/app/routers/users.py`:

Change the models import to include `Team`:

```python
from app.models import Team, User, UserSession
```

In `create_user`, insert the team check before constructing the `User` and pass it through:

```python
    if payload.team_id is not None and db.get(Team, payload.team_id) is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    user = User(
        email=email,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        team_id=payload.team_id,
    )
```

In `update_user`, insert between the self-lockout guard and `password = changes.pop(...)`:

```python
    email = changes.pop("email", None)
    if email is not None:
        email = email.strip().lower()
        if db.scalar(
            select(User).where(func.lower(User.email) == email, User.id != user.id)
        ):
            raise HTTPException(status_code=409, detail="Email already in use")
        user.email = email
    if "team_id" in changes:  # distinguishes "not sent" from explicit null
        team_id = changes.pop("team_id")
        if team_id is not None and db.get(Team, team_id) is None:
            raise HTTPException(status_code=422, detail="team_id does not exist")
        user.team_id = team_id
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/app /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_users.py tests/test_api_auth.py -q`
Expected: PASS (test_api_users 10 passed, test_api_auth 8 passed). Then full suite: `docker compose exec -T backend python -m pytest -q` — expect 111 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/users.py backend/tests/test_api_users.py backend/tests/test_api_auth.py
git commit -m "feat(backend): editable user email + team membership in admin API"
```

---

### Task 3: Frontend types/client + `UserModal`

**Files:**
- Modify: `frontend/src/types.ts` (`AuthUser`)
- Modify: `frontend/src/api/client.ts` (`createUser`, `updateUser` payloads)
- Create: `frontend/src/components/admin/UserModal.tsx`
- Test: `frontend/src/components/admin/UserModal.test.tsx`

**Interfaces:**
- Consumes: backend payload shapes (Task 2), existing `Team` type + `getTeams`.
- Produces: `UserModal` props `{ mode: "create" | "edit"; user?: AuthUser; teams: Team[]; currentUserId: number; onSaved: () => void; onClose: () => void }`. Task 4 renders it.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/admin/UserModal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import UserModal from "./UserModal";

afterEach(() => vi.restoreAllMocks());

const teams = [
  { id: 1, name: "Network" },
  { id: 2, name: "Cloud" },
] as never;

const ben = {
  id: 2, email: "b@b.ch", display_name: "Ben", role: "member",
  is_active: true, team_id: 1, team_name: "Network",
} as never;

it("edit: saves only the changed fields", async () => {
  const update = vi.spyOn(client, "updateUser").mockResolvedValue(ben);
  const onSaved = vi.fn();
  render(
    <UserModal mode="edit" user={ben} teams={teams} currentUserId={1} onSaved={onSaved} onClose={() => {}} />,
  );
  const email = screen.getByLabelText(/email/i);
  await userEvent.clear(email);
  await userEvent.type(email, "new@b.ch");
  await userEvent.selectOptions(screen.getByLabelText(/team/i), "2");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(update).toHaveBeenCalledWith(2, { email: "new@b.ch", team_id: 2 });
  expect(onSaved).toHaveBeenCalled();
});

it("edit: rejected save shows the server detail inline", async () => {
  vi.spyOn(client, "updateUser").mockRejectedValue(
    new Error('409 Conflict: {"detail":"Email already in use"}'),
  );
  render(
    <UserModal mode="edit" user={ben} teams={teams} currentUserId={1} onSaved={() => {}} onClose={() => {}} />,
  );
  const email = screen.getByLabelText(/email/i);
  await userEvent.clear(email);
  await userEvent.type(email, "taken@b.ch");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(await screen.findByText("Email already in use")).toBeInTheDocument();
});

it("edit: role disabled for the current user; empty password not sent", async () => {
  const update = vi.spyOn(client, "updateUser").mockResolvedValue(ben);
  render(
    <UserModal mode="edit" user={ben} teams={teams} currentUserId={2} onSaved={() => {}} onClose={() => {}} />,
  );
  expect(screen.getByLabelText(/role/i)).toBeDisabled();
  const name = screen.getByLabelText(/display name/i);
  await userEvent.clear(name);
  await userEvent.type(name, "Benny");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(update).toHaveBeenCalledWith(2, { display_name: "Benny" });
});

it("create: save disabled until valid, then sends everything", async () => {
  const create = vi.spyOn(client, "createUser").mockResolvedValue(ben);
  render(<UserModal mode="create" teams={teams} currentUserId={1} onSaved={() => {}} onClose={() => {}} />);
  const save = screen.getByRole("button", { name: /^save$/i });
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/display name/i), "Cleo");
  await userEvent.type(screen.getByLabelText(/email/i), "c@b.ch");
  await userEvent.type(screen.getByLabelText(/^password$/i), "pw123456");
  await userEvent.selectOptions(screen.getByLabelText(/team/i), "1");
  await userEvent.click(save);
  expect(create).toHaveBeenCalledWith({
    email: "c@b.ch",
    display_name: "Cleo",
    password: "pw123456",
    role: "member",
    team_id: 1,
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/admin/UserModal.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Widen types + client payloads**

`frontend/src/types.ts` — extend `AuthUser` (after `is_active`):

```ts
  team_id?: number | null;
  team_name?: string | null;
```

`frontend/src/api/client.ts` — widen the two payload types:

```ts
export function createUser(payload: {
  email: string;
  display_name: string;
  password: string;
  role: "admin" | "member";
  team_id?: number | null;
}): Promise<AuthUser> {
  return request<AuthUser>("/api/users", json(payload));
}

export function updateUser(
  id: number,
  payload: Partial<{
    display_name: string;
    email: string;
    role: "admin" | "member";
    is_active: boolean;
    password: string;
    team_id: number | null;
  }>,
): Promise<AuthUser> {
  return request<AuthUser>(`/api/users/${id}`, { ...json(payload), method: "PATCH" });
}
```

- [ ] **Step 4: Create `frontend/src/components/admin/UserModal.tsx`**

```tsx
import { useState } from "react";
import { createUser, updateUser } from "../../api/client";
import type { AuthUser, Team } from "../../types";

/** Extracts the server's `detail` message from a thrown request error. */
function errorDetail(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const match = /"detail"\s*:\s*"([^"]+)"/.exec(text);
  return match ? match[1] : "Could not save user.";
}

export default function UserModal({
  mode,
  user,
  teams,
  currentUserId,
  onSaved,
  onClose,
}: {
  mode: "create" | "edit";
  user?: AuthUser; // required when mode === "edit"
  teams: Team[];
  currentUserId: number;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(user?.display_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [teamId, setTeamId] = useState<number | null>(user?.team_id ?? null);
  const [role, setRole] = useState<"admin" | "member">(user?.role ?? "member");
  const [active, setActive] = useState(user?.is_active ?? true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSelf = mode === "edit" && user?.id === currentUserId;
  const valid =
    name.trim().length > 0 &&
    email.trim().length >= 3 &&
    (mode === "edit" ? password === "" || password.length >= 8 : password.length >= 8);

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        await createUser({
          email: email.trim(),
          display_name: name.trim(),
          password,
          role,
          team_id: teamId,
        });
      } else if (user) {
        const diff: Parameters<typeof updateUser>[1] = {};
        if (name.trim() !== user.display_name) diff.display_name = name.trim();
        if (email.trim().toLowerCase() !== user.email) diff.email = email.trim();
        if ((user.team_id ?? null) !== teamId) diff.team_id = teamId;
        if (role !== user.role) diff.role = role;
        if (active !== user.is_active) diff.is_active = active;
        if (password) diff.password = password;
        if (Object.keys(diff).length) await updateUser(user.id, diff);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errorDetail(e));
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const caption = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400";

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          {mode === "create" ? "Add user" : `Edit ${user?.display_name}`}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block">
            <span className={caption}>Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="col-span-2 block">
            <span className={caption}>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className={caption}>Team</span>
            <select
              value={teamId ?? ""}
              onChange={(e) => setTeamId(e.target.value === "" ? null : Number(e.target.value))}
              className={field}
            >
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={caption}>Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "member")}
              disabled={isSelf}
              className={field}
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label className="col-span-2 block">
            <span className={caption}>
              {mode === "create" ? "Password" : "New password (leave empty to keep)"}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </label>
          {mode === "edit" && !isSelf && (
            <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Active
            </label>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!valid || busy}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests + type-check**

Run: `cd frontend && npx vitest run src/components/admin/UserModal.test.tsx && npx tsc --noEmit`
Expected: PASS (4 passed) and clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/components/admin/UserModal.tsx frontend/src/components/admin/UserModal.test.tsx
git commit -m "feat(frontend): UserModal for create/edit with email, team, password, inline errors"
```

---

### Task 4: UsersSection becomes a full-width table; AdminView placement

**Files:**
- Modify: `frontend/src/components/admin/UsersSection.tsx` (full rewrite)
- Modify: `frontend/src/components/admin/AdminView.tsx`
- Modify: `frontend/src/components/admin/UsersSection.test.tsx` (full rewrite)
- Modify: `frontend/src/components/admin/AdminView.test.tsx` (add `getTeams` mock if absent)

**Interfaces:**
- Consumes: `UserModal` (Task 3), `listUsers`, `getTeams`.
- Produces: `UsersSection({ currentUserId })` — full-width panel; AdminView renders it between the card grid and Capacity.

- [ ] **Step 1: Rewrite the test file**

Replace `frontend/src/components/admin/UsersSection.test.tsx` entirely with:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import UsersSection from "./UsersSection";

afterEach(() => vi.restoreAllMocks());

const anna = {
  id: 1, email: "a@b.ch", display_name: "Anna", role: "admin",
  is_active: true, team_id: 1, team_name: "Network",
} as const;
const ben = {
  id: 2, email: "b@b.ch", display_name: "Ben", role: "member",
  is_active: false, team_id: null, team_name: null,
} as const;

function mockData() {
  vi.spyOn(client, "listUsers").mockResolvedValue([anna, ben] as never);
  vi.spyOn(client, "getTeams").mockResolvedValue([{ id: 1, name: "Network" }] as never);
}

it("renders the table with email, team, and status", async () => {
  mockData();
  render(<UsersSection currentUserId={1} />);
  expect(await screen.findByText("Anna")).toBeInTheDocument();
  expect(screen.getByText("a@b.ch")).toBeInTheDocument();
  expect(screen.getByText("Network")).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument(); // Ben has no team
  expect(screen.getByText("inactive")).toBeInTheDocument();
});

it("opens the edit modal prefilled, and the add modal", async () => {
  mockData();
  render(<UsersSection currentUserId={1} />);
  await screen.findByText("Anna");
  await userEvent.click(screen.getByRole("button", { name: /edit user ben/i }));
  expect(screen.getByDisplayValue("b@b.ch")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
  await userEvent.click(screen.getByRole("button", { name: /add user/i }));
  expect(screen.getByText("Add user")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/admin/UsersSection.test.tsx`
Expected: FAIL — old card UI (no table cells, no edit buttons).

- [ ] **Step 3: Rewrite `frontend/src/components/admin/UsersSection.tsx`**

Replace the file entirely with:

```tsx
import { useEffect, useState } from "react";
import { getTeams, listUsers } from "../../api/client";
import type { AuthUser, Team } from "../../types";
import UserModal from "./UserModal";

const statusPill = (active: boolean) =>
  active
    ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
    : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700";

export default function UsersSection({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = () => {
    void listUsers().then(setUsers);
    void getTeams().then(setTeams);
  };
  useEffect(reload, []);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm ring-1 ring-black/5">
      <header className="mb-4 flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-base text-rose-600"
          aria-hidden
        >
          👤
        </span>
        <h2 className="text-sm font-semibold text-gray-900">Users</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
          {users.length}
        </span>
        <button
          onClick={() => setAdding(true)}
          className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          + Add user
        </button>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="px-2 py-2 font-semibold">Email</th>
              <th className="px-2 py-2 font-semibold">Team</th>
              <th className="px-2 py-2 font-semibold">Role</th>
              <th className="px-2 py-2 font-semibold">Status</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-100 last:border-0">
                <td
                  className={`whitespace-nowrap py-2 pr-3 font-medium ${
                    u.is_active ? "text-gray-800" : "text-gray-400 line-through"
                  }`}
                >
                  {u.display_name}
                </td>
                <td className="px-2 py-2 text-gray-600">{u.email}</td>
                <td className="px-2 py-2 text-gray-600">{u.team_name ?? "—"}</td>
                <td className="px-2 py-2 text-gray-600">{u.role}</td>
                <td className="px-2 py-2">
                  <span className={statusPill(u.is_active)}>{u.is_active ? "active" : "inactive"}</span>
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    aria-label={`edit user ${u.display_name}`}
                    onClick={() => setEditing(u)}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-gray-400">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <UserModal
          mode="create"
          teams={teams}
          currentUserId={currentUserId}
          onSaved={reload}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <UserModal
          mode="edit"
          user={editing}
          teams={teams}
          currentUserId={currentUserId}
          onSaved={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Move it in `AdminView.tsx`**

Remove `<UsersSection currentUserId={user.id} />` from the grid div and insert a full-width block between the grid and Capacity:

```tsx
      <div className="grid items-start gap-4 md:grid-cols-2 lg:grid-cols-3">
        <TeamsSection onChanged={onChanged} />
        <TeamMembersSection onChanged={onChanged} />
        <PlanningIntervalsSection onChanged={onChanged} />
      </div>
      <div className="mt-4">
        <UsersSection currentUserId={user.id} />
      </div>
      <div className="mt-4">
        <CapacitySection planningIntervals={planningIntervals} />
      </div>
```

In `frontend/src/components/admin/AdminView.test.tsx`: both tests already mock `listUsers`; ensure both ALSO mock `getTeams` (`vi.spyOn(client, "getTeams").mockResolvedValue([] as never)`) — `TeamMembersSection` may already mock it in one test; add wherever missing so no unmocked fetch fires.

- [ ] **Step 5: Run the full frontend suite + type-check**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: ALL pass (153 = 149 + 4 UserModal; the 2 reworked UsersSection tests replace the old 2), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/UsersSection.tsx frontend/src/components/admin/UsersSection.test.tsx frontend/src/components/admin/AdminView.tsx frontend/src/components/admin/AdminView.test.tsx
git commit -m "feat(frontend): full-width users table with edit/add modals"
```

---

### Task 5: Deploy + end-to-end smoke

**Files:** none (deploy + verification only)

- [ ] **Step 1: Rebuild the backend image (includes migration 0009 at startup)**

```bash
docker compose up -d --build backend
docker compose exec -T backend alembic current   # expect: 0009 (head)
```

- [ ] **Step 2: Deploy the frontend**

Try the image build first; if Docker Hub is still unreachable use the fallback:

```bash
docker compose up -d --build frontend || true
# Fallback (known Hub outage):
cd frontend && npm run build && cd ..
docker compose exec -T frontend sh -c 'rm -rf /usr/share/nginx/html/*'
docker compose cp frontend/dist/. frontend:/usr/share/nginx/html/
```

- [ ] **Step 3: Curl smoke through nginx**

```bash
curl -s -c /tmp/ua-cookies -X POST localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin"}' | head -c 200   # 200 + user JSON with team_id/team_name
TEAM_ID=$(curl -s -b /tmp/ua-cookies localhost:8080/api/teams | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
USER_ID=$(curl -s -b /tmp/ua-cookies localhost:8080/api/users | python3 -c "import sys,json; print([u for u in json.load(sys.stdin) if u['role']=='member'][0]['id'])")
curl -s -b /tmp/ua-cookies -X PATCH localhost:8080/api/users/$USER_ID \
  -H 'Content-Type: application/json' -d "{\"team_id\": $TEAM_ID}" | python3 -m json.tool | grep team   # team_id + team_name set
curl -s -b /tmp/ua-cookies -X PATCH localhost:8080/api/users/$USER_ID \
  -H 'Content-Type: application/json' -d '{"email":"admin@example.com"}' -o /dev/null -w "%{http_code}\n"   # 409
rm -f /tmp/ua-cookies
```

- [ ] **Step 4: Browser check** (controller does this with Playwright if executing via subagents): Admin → Users shows the full-width table with Team/Status columns; Edit opens the prefilled modal; changing team + saving updates the row; Add user creates a row; duplicate email shows the inline 409 message.

- [ ] **Step 5: Commit** — nothing to commit in this task unless smoke revealed fixes.

---

## Self-Review Notes

- **Spec coverage:** migration/model/property (T1); schemas + PATCH email/team semantics incl. 409/422/self-exclusion + `/me` exposure (T2); types/client widening + UserModal with diff-only saves and inline errors (T3); table UX + AdminView placement + guards in modal (T4); deploy/smoke (T5). Scope guards need no tasks (they're omissions).
- **Type consistency:** `UserModal` props consumed in T4 match T3's export; `updateUser` diff type via `Parameters<typeof updateUser>[1]`; `AuthUser` optional team fields used with `?? "—"`/`?? null` everywhere.
- **Known trade-offs:** `reload()` in UsersSection refetches teams alongside users (cheap, keeps modal team list fresh); table has no sort/search (spec scope guard); UserModal's role/active self-guards mirror the server's 422 self-lockout.
