# Local Login for Admin-Created Users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins create/edit local user accounts with a `username` so they can sign in via the Local login method.

**Architecture:** Extend the users admin API and modal to manage `username`. A login-capable local account = username + password; email becomes optional and decoupled from the password. No migration (the `username` column already exists from the LDAP work).

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic (backend); React + TypeScript, vitest + testing-library (frontend).

## Global Constraints

- A password requires a `username` (replaces the old "password requires email" rule).
- `username` is globally unique; a duplicate → `409 "Username already in use"`.
- Email is optional and independent of the password.
- Backend tests: `cd backend && python -m pytest`. Frontend: `cd frontend && npx vitest run`.
- No DB migration — `users.username` already exists.

---

### Task 1: Backend — username in users API

**Files:**
- Modify: `backend/app/schemas.py` (`UserCreate`, `UserUpdate`, `UserRead`)
- Modify: `backend/app/routers/users.py` (`create_user`, `update_user`)
- Test: `backend/tests/test_api_users.py`

**Interfaces:**
- Produces: `UserCreate.username`, `UserUpdate.username`, `UserRead.username` (all `str | None`); `POST /api/v1/users` and `PATCH /api/v1/users/{id}` accept/return `username`.

- [ ] **Step 1: Update the existing create tests to include a username, add the new failing tests**

In `backend/tests/test_api_users.py`:

In `test_admin_crud_and_duplicate`, add `"username": "newuser"` to the first create payload and `"username": "newuser2"` to the dupe payload (they carry a password and would now 422 without one).

In `test_create_with_team`, add `"username": "u1"` to the first payload and `"username": "v1"` to the second.

Then append these new tests:

```python
def test_local_login_account_can_authenticate(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    _as(admin)
    created = anon_client.post(
        "/api/v1/users",
        json={"username": "cleo", "display_name": "Cleo", "password": "longenough1", "role": "member"},
    )
    assert created.status_code == 201
    assert created.json()["username"] == "cleo"
    # Clear the admin override so the real cookie-auth login path runs.
    app.dependency_overrides.pop(get_current_user, None)
    login = anon_client.post(
        "/api/v1/auth/login",
        json={"username": "cleo", "password": "longenough1", "method": "local"},
    )
    assert login.status_code == 200


def test_password_without_username_is_422(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    _as(admin)
    resp = anon_client.post(
        "/api/v1/users",
        json={"email": "p@x.ch", "display_name": "P", "password": "longenough1", "role": "member"},
    )
    assert resp.status_code == 422


def test_duplicate_username_is_409(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin", username="admin")
    _as(admin)
    resp = anon_client.post(
        "/api/v1/users",
        json={"username": "admin", "display_name": "Clone", "password": "longenough1", "role": "member"},
    )
    assert resp.status_code == 409


def test_edit_add_username_and_password_enables_login(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")  # seeded with a hash but no username
    member.password_hash = None
    db_session.commit()
    _as(admin)
    resp = anon_client.patch(
        f"/api/v1/users/{member.id}",
        json={"username": "mem", "password": "longenough1"},
    )
    assert resp.status_code == 200
    assert resp.json()["username"] == "mem"


def test_clearing_username_with_password_is_422(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch", username="mem")  # has password_hash + username
    _as(admin)
    resp = anon_client.patch(f"/api/v1/users/{member.id}", json={"username": ""})
    assert resp.status_code == 422


def test_clearing_email_with_password_now_succeeds(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch", username="mem")  # has password_hash + username + email
    _as(admin)
    resp = anon_client.patch(f"/api/v1/users/{member.id}", json={"email": ""})
    assert resp.status_code == 200
    assert resp.json()["email"] is None
```

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && python -m pytest tests/test_api_users.py -q`
Expected: FAIL — new tests error (username field unknown / wrong status codes), and `test_clearing_email_with_password_now_succeeds` still hits the old 422 guard.

- [ ] **Step 3: Add `username` to the schemas**

In `backend/app/schemas.py`:

In `UserCreate`, add after `display_name`:
```python
    username: str | None = Field(default=None, min_length=1, max_length=150)
```
In `UserUpdate`, add (matching its optional style):
```python
    username: str | None = None
```
In `UserRead`, add after `email`:
```python
    username: str | None = None
```

- [ ] **Step 4: Update `create_user`**

In `backend/app/routers/users.py`, replace the top of `create_user` (the `email` line through the `team_id` check) with:

```python
    email = (payload.email or "").strip().lower() or None  # whitespace-only -> None
    username = (payload.username or "").strip() or None
    if payload.password is not None and username is None:
        raise HTTPException(status_code=422, detail="Password requires a username")
    if email and db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status_code=409, detail="Email already in use")
    if username and db.scalar(select(User).where(User.username == username)):
        raise HTTPException(status_code=409, detail="Username already in use")
    if payload.team_id is not None and db.get(Team, payload.team_id) is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    user = User(
        email=email,
        username=username,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password) if payload.password else None,
        role=payload.role,
        team_id=payload.team_id,
    )
```

- [ ] **Step 5: Update `update_user`**

In `backend/app/routers/users.py`, in `update_user`:

(a) Add `"username"` to the audited tuple:
```python
    for key in ("email", "username", "display_name", "role", "is_active", "team_id"):
```

(b) Relax the email guard — replace the `if email is None:` branch:
```python
        if email is None:
            user.email = None  # email is optional and independent of the password
```

(c) After the `if "email" in changes:` block, insert username normalization + uniqueness:
```python
    if "username" in changes:
        raw = changes.get("username")
        norm = (raw.strip() if raw else "") or None
        changes["username"] = norm
        if norm and db.scalar(
            select(User).where(User.username == norm, User.id != user.id)
        ):
            raise HTTPException(status_code=409, detail="Username already in use")
```

(d) Right after `password = changes.pop("password", None)`, enforce the invariant:
```python
    final_username = changes["username"] if "username" in changes else user.username
    if (user.password_hash is not None or password is not None) and final_username is None:
        raise HTTPException(status_code=422, detail="Password requires a username")
```

(The remaining `setattr` loop applies `user.username = norm`; the audited loop logs the change.)

- [ ] **Step 6: Run the users suite**

Run: `cd backend && python -m pytest tests/test_api_users.py -q`
Expected: PASS

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS (246+ prior tests plus the new ones).

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/users.py backend/tests/test_api_users.py
git commit -m "feat(users): manage username so local accounts can log in"
```

---

### Task 2: Frontend — username field in the user modal

**Files:**
- Modify: `frontend/src/types.ts` (`AuthUser`)
- Modify: `frontend/src/api/client.ts` (`createUser`, `updateUser` payload types)
- Modify: `frontend/src/components/admin/UserModal.tsx`
- Test: `frontend/src/components/admin/UserModal.test.tsx`

**Interfaces:**
- Consumes: `POST/PATCH /api/v1/users` accepting `username` (Task 1).
- Produces: `AuthUser.username?: string | null`; `createUser`/`updateUser` payloads include `username`.

- [ ] **Step 1: Update the existing modal tests and add the new failing test**

In `frontend/src/components/admin/UserModal.test.tsx`:

In `create: save disabled until valid, then sends everything`, add a username type and the field in the expected payload:
```typescript
  await userEvent.type(screen.getByLabelText(/display name/i), "Cleo");
  await userEvent.type(screen.getByLabelText(/username/i), "cleo");
  await userEvent.type(screen.getByLabelText(/email/i), "c@b.ch");
  await userEvent.type(screen.getByLabelText(/^password$/i), "pw123456");
  await userEvent.selectOptions(screen.getByLabelText(/team/i), "1");
  await userEvent.click(save);
  expect(create).toHaveBeenCalledWith({
    email: "c@b.ch",
    username: "cleo",
    display_name: "Cleo",
    password: "pw123456",
    role: "member",
    team_id: 1,
  });
```

In `create: name only posts null email and password (person, no login)`, add `username: null` to the expected payload:
```typescript
  expect(create).toHaveBeenCalledWith({
    email: null,
    username: null,
    display_name: "Cleo",
    password: null,
    role: "member",
    team_id: null,
  });
```

Replace `edit: clearing the email of a passworded user surfaces the server detail` with a username-clear guard test (the email guard is gone):
```typescript
it("edit: clearing the username of a passworded user surfaces the server detail", async () => {
  const withLogin = { ...ben, username: "ben" } as never;
  const update = vi.spyOn(client, "updateUser").mockRejectedValue(
    new Error('422 Unprocessable Entity: {"detail":"Password requires a username"}'),
  );
  render(
    <UserModal mode="edit" user={withLogin} teams={teams} currentUserId={1} onSaved={() => {}} onClose={() => {}} />,
  );
  const username = screen.getByLabelText(/username/i);
  await userEvent.clear(username);
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(await screen.findByText("Password requires a username")).toBeInTheDocument();
  expect(update).toHaveBeenCalledWith(2, { username: null });
});
```

Add a new validation test:
```typescript
it("create: a password without a username keeps Save disabled", async () => {
  render(<UserModal mode="create" teams={teams} currentUserId={1} onSaved={() => {}} onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText(/display name/i), "Cleo");
  await userEvent.type(screen.getByLabelText(/^password$/i), "pw123456");
  expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/username/i), "cleo");
  expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
});
```

- [ ] **Step 2: Run to verify failures**

Run: `cd frontend && npx vitest run src/components/admin/UserModal.test.tsx`
Expected: FAIL — no username field; payloads lack `username`.

- [ ] **Step 3: Extend the `AuthUser` type**

In `frontend/src/types.ts`, add to `AuthUser` (after `email`):
```typescript
  username?: string | null;
```

- [ ] **Step 4: Extend the client payload types**

In `frontend/src/api/client.ts`, add `username: string | null;` to the `createUser` payload object and `username: string | null;` to the `updateUser` `Partial<{...}>`.

- [ ] **Step 5: Add the Username field + validation to `UserModal`**

In `frontend/src/components/admin/UserModal.tsx`:

Add state after `email`:
```typescript
  const [username, setUsername] = useState(user?.username ?? "");
```

Replace the validation block:
```typescript
  const isSelf = mode === "edit" && user?.id === currentUserId;
  const emailOk = email.trim() === "" || email.trim().length >= 3;
  const passwordOk =
    password === "" ? true : password.length >= 8 && username.trim() !== "";
  const valid = name.trim().length > 0 && emailOk && passwordOk;
```

In the create payload, add `username`:
```typescript
        await createUser({
          email: email.trim() === "" ? null : email.trim(),
          username: username.trim() === "" ? null : username.trim(),
          display_name: name.trim(),
          password: password === "" ? null : password,
          role,
          team_id: teamId,
        });
```

In the edit diff, add username handling after the email diff:
```typescript
        const trimmedUsername = username.trim();
        if (trimmedUsername !== (user.username ?? "")) {
          diff.username = trimmedUsername === "" ? null : trimmedUsername;
        }
```

Add the Username input as a field (place it above Email), and move the "needed to log in" hint here:
```tsx
          <label className="col-span-2 block">
            <span className={caption}>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Optional — needed to log in"
              className={field}
            />
          </label>
```
And change the Email input's `placeholder` to `"Optional"`.

- [ ] **Step 6: Run the modal tests**

Run: `cd frontend && npx vitest run src/components/admin/UserModal.test.tsx`
Expected: PASS

- [ ] **Step 7: Full frontend suite + build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS (build = tsc typecheck clean).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/components/admin/UserModal.tsx frontend/src/components/admin/UserModal.test.tsx
git commit -m "feat(users): username field in the admin user modal"
```

---

## Final verification

- [ ] Backend: `cd backend && python -m pytest -q` → green.
- [ ] Frontend: `cd frontend && npx vitest run && npm run build` → green.
- [ ] Manual smoke in the Docker stack (rebuild images): as admin, create a user with username `demo` + a password; log out; log in via the **Local** method as `demo` → lands in the app.
