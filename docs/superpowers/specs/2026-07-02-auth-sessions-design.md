# Authentication & User Sessions — Design

**Date:** 2026-07-02
**Status:** Approved (design); pending spec review

## Goal

Put the whole app behind a login. Accounts live in the database (no IdP yet,
but the architecture must let OIDC/SSO slot in later without rework). Two
roles: **admin** and **member**. Server-side sessions delivered in an
HttpOnly cookie (the SPA and API are same-origin via the nginx `/api/` proxy).

Decisions made during brainstorming:

- **Sessions, not JWTs:** opaque token in an HttpOnly `SameSite=Lax` cookie,
  session rows in Postgres. Immediate revocation (logout, deactivation), no
  key management, no XSS-readable secrets. The same opaque token is also
  accepted as `Authorization: Bearer <token>` for future scripts/API clients.
- **Roles v1:** `admin` (everything, incl. user management, Admin page
  mutations, CSV import, lane editing) and `member` (work with items/links,
  read everything else). No viewer role yet.
- **Provisioning:** admins create users with a password; no forced change at
  first login. Users can change their own password. The initial admin is
  seeded from environment variables on first startup.
- **Postponed:** the audit trail (feature #2) restarts after this lands and
  will use the session user as its actor.

## Data model (migration `0008_users_sessions`, down_revision `0007`)

```python
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)   # stored lowercase; login key
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255)) # None for future IdP users
    role: Mapped[str] = mapped_column(String(16), default="member")  # 'admin' | 'member'
    is_active: Mapped[bool] = mapped_column(default=True)
    auth_provider: Mapped[str] = mapped_column(String(16), default="local")  # 'oidc' later
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # sha256 hex of raw token
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column()
```

Only the **sha256 of the token** is stored — a leaked DB dump yields no usable
sessions. The raw token (43 chars, `secrets.token_urlsafe(32)`) exists only in
the cookie. No `users` hard-delete anywhere: accounts are deactivated
(`is_active=False`), preserving referential integrity for the future audit trail.

## Auth module (`backend/app/auth.py`)

New dependency: `bcrypt>=4.1` (direct library, not passlib).

- `hash_password(pw) -> str` / `verify_password(pw, hash) -> bool` (bcrypt).
- `create_session(db, user) -> str` — inserts a `UserSession`
  (`expires_at = now + SESSION_TTL`), returns the raw token. Also deletes that
  user's already-expired sessions (opportunistic cleanup).
- `get_current_user(request, db) -> User | None` — reads the `kanban_session`
  cookie, falling back to `Authorization: Bearer <token>`; looks up
  `sha256(token)`; returns `None` if missing/expired/user-inactive. **Sliding
  TTL:** if less than half the TTL remains, extends `expires_at` to
  `now + SESSION_TTL`.
- `require_user(user = Depends(get_current_user)) -> User` — raises 401.
- `require_admin(user = Depends(require_user)) -> User` — raises 403 unless
  `role == "admin"`.

Constants/config (extend `app/config.py` `Settings`):
`session_ttl_days = 14`, `cookie_secure = False`,
`bootstrap_admin = False`, `initial_admin_email = "admin@example.com"`,
`initial_admin_password = "admin"`, `initial_admin_name = "Admin"`.

Cookie attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=<ttl>`;
`Secure` only when `cookie_secure` is true (dev runs plain HTTP).

## Endpoints

**`backend/app/routers/auth.py`** (`prefix="/api/auth"`):

- `POST /login` `{email, password}` → 200 `UserRead` + `Set-Cookie`. The same
  401 (`"Invalid credentials"`) for unknown email, wrong password, and
  inactive account — no user enumeration. Email matching is case-insensitive.
- `POST /logout` → 204 always (idempotent): deletes the session row if the
  cookie resolves, clears the cookie either way.
- `GET /me` → `UserRead`, 401 when not logged in. (The SPA's boot probe.)
- `PATCH /me/password` `{current_password, new_password}` → 204. Verifies
  `current_password` (401 mismatch), `new_password` min length 8 (422 via
  schema). Revokes **all other sessions** of the user; the current one stays.

**`backend/app/routers/users.py`** (`prefix="/api/users"`, admin-only):

- `GET ""` → all users ordered by `display_name`.
- `POST ""` `{email, display_name, password, role}` → 201; 409 on duplicate
  email (case-insensitive); password min 8; role validated to `admin|member`.
- `PATCH /{user_id}` `{display_name?, role?, is_active?, password?}` → 200.
  Setting `password` is the admin reset (revokes all of that user's sessions).
  **Self-lockout guard:** an admin cannot set their own `role` to member or
  their own `is_active` to false (422).
- No `DELETE` route.

Schemas: `UserRead {id, email, display_name, role, is_active}`,
`LoginRequest`, `UserCreate`, `UserUpdate`, `PasswordChange`
(`new_password`/`password` fields: `Field(min_length=8, max_length=72)` —
72 is bcrypt's hard input limit; bcrypt ≥5 raises on longer inputs).
`verify_password` returns `False` (never raises) on malformed/oversized
input, so a >72-byte login attempt yields the normal 401.

## Route protection matrix

Applied in `main.py` at registration (`app.include_router(r, dependencies=[Depends(require_user)])`)
so existing router files stay untouched except where admin gates go on
specific mutating endpoints (`dependencies=[Depends(require_admin)]` on the
route decorator):

| Surface | member | admin |
|---|---|---|
| `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/logout` | open (no auth; logout is idempotent) | open |
| `/api/auth/me`, `/api/auth/me/password` | ✓ | ✓ |
| items + links: all methods | ✓ | ✓ |
| boards `GET /boards`; teams/members/PIs/capacities `GET` | ✓ | ✓ |
| lanes mutations (`POST/PATCH/DELETE` lane, `PUT lanes/order`) | 403 | ✓ |
| teams / team_members / planning_intervals / capacities mutations | 403 | ✓ |
| `POST /api/import` | 403 | ✓ |
| `/api/users/*` | 403 | ✓ |

`/api/health` must stay unauthenticated — the Docker healthcheck depends on it.

## Bootstrap

`ensure_initial_admin()` runs in the FastAPI lifespan **only when
`settings.bootstrap_admin` is true** (set in docker-compose; unset in tests so
`TestClient(app)` startup never touches a real DB). If the `users` table is
empty it creates the initial admin from `initial_admin_*` settings and logs
the email. docker-compose passes `BOOTSTRAP_ADMIN=true` plus the three
`INITIAL_ADMIN_*` vars (dev defaults visible in the file, comment: override
in production).

## Frontend

- **`api/client.ts`:** `AuthUser` type; `login`, `logout`, `getMe`,
  `changeMyPassword`, `listUsers`, `createUser`, `updateUser`. Cookies flow
  automatically (same-origin fetch). New `setUnauthorizedHandler(cb)`: the
  shared `request()` invokes it on any 401 **except** from `/api/auth/login`
  and the initial `getMe` probe, flipping the app back to the login screen
  when a session dies mid-use.
- **`App.tsx` gating:** `user: AuthUser | null` + `authChecked` state; on
  mount `getMe()`. Not checked → neutral splash; `null` → `<LoginPage
  onLoggedIn={setUser}/>`; logged in → the app. Registers the
  unauthorized handler (`setUser(null)`).
- **`LoginPage.tsx`:** centered card on `bg-gray-50` (modern style of the
  app): title, email, password, submit; inline error on 401.
- **Header:** user chip right of the nav — display name + role pill
  (admin: violet), a "Change password" item (small modal, calls
  `changeMyPassword`) and "Log out" (calls `logout`, resets user state).
- **Role-aware UI (server enforces regardless):** members don't see the
  Admin nav tab, the Import CSV button, or the board's "Edit lanes" button.
- **`admin/UsersSection.tsx`:** new `AdminCard` ("Users", 👤, rose accent) —
  list (name, email, role select, active toggle, reset-password button with
  `window.prompt`), create form (name, email, password, role). Mirrors the
  existing sections' style and `onChanged` wiring.

## Test impact

Backend (`conftest.py`):

- `client` fixture additionally creates an **admin user** in `db_session` and
  overrides `get_current_user` to return it — the existing 79 tests keep
  passing unchanged (they now run "as admin").
- New `member_client` (same, role member) for 403 tests; new `anon_client`
  (only the `get_db` override) for the real login/cookie flow tests.

New backend tests: bcrypt roundtrip; login sets cookie + `/me` roundtrip; the
three identical-401 login failures; logout revokes; Bearer-header acceptance;
sliding renewal; password change revokes other sessions; users CRUD + 409 +
self-lockout guard; member 403 on admin surfaces (import, user create, lane
mutation, team mutation); anon 401 on `/api/items`; bootstrap seeds once and
only when flagged.

Frontend tests: LoginPage submits and surfaces 401 errors; App gating
(`getMe` 401 → login rendered; success → app rendered); UsersSection
list/create/toggle; header logout calls `logout`.

## IdP readiness (how OIDC slots in later)

- `email` is the join key; IdP users become rows with `auth_provider="oidc"`
  and `password_hash=None` (login with a password is refused for them).
- A future `GET /api/auth/oidc/callback` verifies the IdP token once and then
  calls the same `create_session()` — cookies, gating, and the whole frontend
  are unchanged.
- Role mapping from IdP claims can later overwrite `role` at login; until
  then roles are DB-managed. Nothing else in the app knows how a session was
  created.

## Security notes / scope guards (v1)

- CSRF: `SameSite=Lax` + same-origin JSON APIs is the v1 posture; no CSRF
  tokens.
- No rate limiting / lockout on login attempts (future hardening, noted).
- No password complexity rules beyond min length 8; no forced rotation.
- No email sending, invites, or self-registration. No user hard-delete.
- Sessions expire after 14 days sliding; expired rows are cleaned
  opportunistically at login, no background job.
- The audit trail, viewer role, and OIDC are explicitly out of scope for v1.
