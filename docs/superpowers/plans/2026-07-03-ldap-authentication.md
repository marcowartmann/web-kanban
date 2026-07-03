# LDAP Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate users against the existing OpenLDAP directory (login by `uid`) while keeping local database accounts as a fallback, selectable from the login page.

**Architecture:** FastAPI binds directly to LDAP (search-then-bind via `ldap3`) — no OIDC/Authentik service. Login routes explicitly by a `method` field: `local` → bcrypt against a DB row, `ldap` → directory bind + find-or-provision. A new `username` column persists the login identifier for both providers. All existing session/cookie/audit machinery is reused unchanged.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, `ldap3` (pure-Python), Postgres (prod) / SQLite (unit tests), React + TypeScript (frontend).

## Global Constraints

- Python `>=3.14`; backend deps declared in `backend/pyproject.toml`.
- Uniform login failure: always `HTTP 401 {"detail": "Invalid credentials"}` with an `auth.login_failed` audit event — local and LDAP failures must be indistinguishable.
- Unit tests run on in-memory SQLite via `Base.metadata.create_all` (NOT migrations). The Alembic migration is verified separately by upgrade **and** downgrade against the compose Postgres (project rule).
- LDAP feature is **off by default** (`ldap_enabled=false`) so existing dev/tests are unaffected.
- Never log or persist the plaintext password. Reject empty passwords on LDAP bind (an empty password against a DN is an anonymous bind on many servers and would falsely "succeed").
- Backend tests: `cd backend && python -m pytest`. Frontend tests: `cd frontend && npm test`.

---

### Task 1: `username` column, migration, bootstrap admin

**Files:**
- Modify: `backend/app/models.py` (User model, ~line 207)
- Modify: `backend/app/config.py`
- Modify: `backend/app/auth.py` (`ensure_initial_admin`, ~line 100)
- Create: `backend/alembic/versions/0017_user_username.py`
- Test: `backend/tests/test_auth_models.py`, `backend/tests/test_bootstrap.py`

**Interfaces:**
- Produces: `User.username: Mapped[str | None]` (unique); `settings.initial_admin_username: str`; migration revision `"0017"`.

- [ ] **Step 1: Write the failing model + bootstrap tests**

In `backend/tests/test_auth_models.py` add:

```python
def test_user_has_username_column(db_session):
    from app.models import User
    u = User(username="jdoe", display_name="J", email="j@x.ch")
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    assert u.username == "jdoe"
```

In `backend/tests/test_bootstrap.py` add (import `ensure_initial_admin`, `settings`, `User`, `select` as the file already does):

```python
def test_bootstrap_admin_gets_username(db_session, monkeypatch):
    from app.auth import ensure_initial_admin
    from app.config import settings
    from app.models import User
    from sqlalchemy import select
    monkeypatch.setattr(settings, "initial_admin_username", "root")
    ensure_initial_admin(db_session)
    admin = db_session.scalar(select(User))
    assert admin.username == "root"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_auth_models.py::test_user_has_username_column tests/test_bootstrap.py::test_bootstrap_admin_gets_username -v`
Expected: FAIL — `TypeError: 'username' is an invalid keyword argument` / AttributeError.

- [ ] **Step 3: Add the column to the model**

In `backend/app/models.py`, inside `class User(Base)`, directly under the `email` column (~line 208):

```python
    username: Mapped[str | None] = mapped_column(String(150), unique=True)  # login id (uid for ldap); NULL = cannot log in
```

- [ ] **Step 4: Add config key**

In `backend/app/config.py`, add to `Settings` under `initial_admin_name`:

```python
    initial_admin_username: str = "admin"
```

- [ ] **Step 5: Set username in bootstrap**

In `backend/app/auth.py`, in `ensure_initial_admin`, add `username=` to the `User(...)` constructor:

```python
    db.add(
        User(
            email=settings.initial_admin_email.strip().lower(),
            username=settings.initial_admin_username.strip(),
            display_name=settings.initial_admin_name,
            password_hash=hash_password(settings.initial_admin_password),
            role="admin",
        )
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_auth_models.py::test_user_has_username_column tests/test_bootstrap.py::test_bootstrap_admin_gets_username -v`
Expected: PASS

- [ ] **Step 7: Write the migration**

Create `backend/alembic/versions/0017_user_username.py`:

```python
"""user.username: login identifier (uid for ldap), unique

Revision ID: 0017
Revises: 0016
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(150), nullable=True))
    # Backfill existing rows from the email local-part; suffix collisions with
    # the row id; rows with no email fall back to user-<id>.
    conn = op.get_bind()
    users = sa.table(
        "users",
        sa.column("id", sa.Integer),
        sa.column("email", sa.String),
        sa.column("username", sa.String),
    )
    seen: set[str] = set()
    for row in conn.execute(sa.select(users.c.id, users.c.email).order_by(users.c.id)):
        base = (row.email.split("@")[0] if row.email else "") or f"user-{row.id}"
        name = base if base not in seen else f"{base}-{row.id}"
        seen.add(name)
        conn.execute(sa.update(users).where(users.c.id == row.id).values(username=name))
    op.create_unique_constraint("uq_users_username", "users", ["username"])


def downgrade() -> None:
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_column("users", "username")
```

- [ ] **Step 8: Dry-run the migration against compose Postgres (upgrade AND downgrade)**

Run:
```bash
docker compose up -d db
cd backend && alembic upgrade head
alembic downgrade -1
alembic upgrade head
```
Expected: all three succeed with no error; `\d users` shows the `username` column and `uq_users_username` constraint after upgrade, absent after downgrade. (Project rule: a migration is not accepted until upgrade+downgrade both pass on real Postgres.)

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && python -m pytest`
Expected: PASS (no regressions; `create_all` now includes `username`).

- [ ] **Step 10: Commit**

```bash
git add backend/app/models.py backend/app/config.py backend/app/auth.py backend/alembic/versions/0017_user_username.py backend/tests/test_auth_models.py backend/tests/test_bootstrap.py
git commit -m "feat(auth): add users.username login identifier + migration"
```

---

### Task 2: LDAP client (`ldap3` search-then-bind) + config

**Files:**
- Modify: `backend/pyproject.toml` (add `ldap3` dependency)
- Modify: `backend/app/config.py` (LDAP settings)
- Create: `backend/app/ldap_auth.py`
- Modify: `.env.example`
- Test: `backend/tests/test_ldap_auth.py` (new)

**Interfaces:**
- Consumes: `settings` from Task 1's config module.
- Produces:
  - `LdapIdentity(uid: str, email: str | None, display_name: str)` dataclass.
  - `class LdapAuthenticator` with `__init__(self, settings, connection_factory=None)` and `authenticate(self, uid: str, password: str) -> LdapIdentity | None`.
  - `get_authenticator() -> LdapAuthenticator` (FastAPI dependency).
  - The `connection_factory(user: str | None, password: str | None) -> ldap3.Connection` seam used by tests.

- [ ] **Step 1: Add the dependency**

In `backend/pyproject.toml`, add to `dependencies`:

```toml
    "ldap3>=2.9",
```

Then install:
```bash
cd backend && pip install -e .
```
Expected: `ldap3` installs successfully.

- [ ] **Step 2: Add LDAP config keys**

In `backend/app/config.py`, add to `Settings`:

```python
    ldap_enabled: bool = False
    ldap_server_uri: str = "ldaps://ldap.internal:636"
    ldap_start_tls: bool = False
    ldap_ca_cert_file: str = ""
    ldap_bind_dn: str = ""
    ldap_bind_password: str = ""
    ldap_base_dn: str = "ou=people,dc=example,dc=com"
    ldap_user_filter: str = "(&(objectClass=inetOrgPerson)(uid={uid}))"
    ldap_attr_email: str = "mail"
    ldap_attr_display_name: str = "cn"
```

- [ ] **Step 3: Write the failing LDAP client tests**

Create `backend/tests/test_ldap_auth.py`:

```python
import ldap3
import pytest

from app.config import Settings
from app.ldap_auth import LdapAuthenticator, LdapIdentity

DIRECTORY = {
    "cn=reader,dc=ex,dc=com": {
        "objectClass": ["inetOrgPerson"], "sn": "reader", "userPassword": "readerpw",
    },
    "uid=jdoe,ou=people,dc=ex,dc=com": {
        "objectClass": ["inetOrgPerson"], "sn": "Doe", "uid": "jdoe",
        "mail": "jdoe@ex.com", "cn": "John Doe", "userPassword": "s3cret",
    },
    "uid=dupe,ou=people,dc=ex,dc=com": {
        "objectClass": ["inetOrgPerson"], "sn": "One", "uid": "dupe",
        "mail": "one@ex.com", "cn": "One", "userPassword": "pw",
    },
    "uid=dupe,ou=other,dc=ex,dc=com": {
        "objectClass": ["inetOrgPerson"], "sn": "Two", "uid": "dupe",
        "mail": "two@ex.com", "cn": "Two", "userPassword": "pw",
    },
}


def _mock_factory():
    def factory(user, password):
        server = ldap3.Server("mock")
        conn = ldap3.Connection(
            server, user=user, password=password, client_strategy=ldap3.MOCK_SYNC,
        )
        for dn, attrs in DIRECTORY.items():
            conn.strategy.add_entry(dn, attrs)
        return conn
    return factory


def _auth():
    s = Settings(
        ldap_enabled=True,
        ldap_bind_dn="cn=reader,dc=ex,dc=com",
        ldap_bind_password="readerpw",
        ldap_base_dn="dc=ex,dc=com",
    )
    return LdapAuthenticator(s, connection_factory=_mock_factory())


def test_valid_credentials_return_identity():
    ident = _auth().authenticate("jdoe", "s3cret")
    assert ident == LdapIdentity(uid="jdoe", email="jdoe@ex.com", display_name="John Doe")


def test_wrong_password_returns_none():
    assert _auth().authenticate("jdoe", "nope") is None


def test_empty_password_returns_none():
    assert _auth().authenticate("jdoe", "") is None


def test_unknown_uid_returns_none():
    assert _auth().authenticate("ghost", "s3cret") is None


def test_multiple_matches_return_none():
    assert _auth().authenticate("dupe", "pw") is None
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_ldap_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.ldap_auth'`.

- [ ] **Step 5: Implement the LDAP client**

Create `backend/app/ldap_auth.py`:

```python
from dataclasses import dataclass

import ldap3
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars

from app.config import settings


@dataclass(frozen=True)
class LdapIdentity:
    uid: str
    email: str | None
    display_name: str


class LdapAuthenticator:
    def __init__(self, config, connection_factory=None):
        self._c = config
        self._connect = connection_factory or self._real_connection

    def _real_connection(self, user, password):
        server = ldap3.Server(
            self._c.ldap_server_uri,
            use_ssl=not self._c.ldap_start_tls,
            tls=ldap3.Tls(ca_certs_file=self._c.ldap_ca_cert_file or None),
        )
        conn = ldap3.Connection(server, user=user or None, password=password or None)
        if self._c.ldap_start_tls:
            conn.start_tls()
        return conn

    def authenticate(self, uid: str, password: str) -> LdapIdentity | None:
        # Empty password would be an anonymous bind on many servers: reject early.
        if not uid or not password:
            return None
        try:
            svc = self._connect(self._c.ldap_bind_dn, self._c.ldap_bind_password)
            if not svc.bind():
                return None
            flt = self._c.ldap_user_filter.replace("{uid}", escape_filter_chars(uid))
            svc.search(
                self._c.ldap_base_dn,
                flt,
                attributes=[self._c.ldap_attr_email, self._c.ldap_attr_display_name],
            )
            if len(svc.entries) != 1:
                return None
            entry = svc.entries[0]
            user_conn = self._connect(entry.entry_dn, password)
            if not user_conn.bind():
                return None
            email = self._attr(entry, self._c.ldap_attr_email)
            display = self._attr(entry, self._c.ldap_attr_display_name) or uid
            return LdapIdentity(uid=uid, email=email, display_name=display)
        except LDAPException:
            return None

    @staticmethod
    def _attr(entry, name: str) -> str | None:
        try:
            value = entry[name].value
        except (LDAPException, KeyError):
            return None
        return str(value) if value else None


def get_authenticator() -> LdapAuthenticator:
    return LdapAuthenticator(settings)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_ldap_auth.py -v`
Expected: PASS (all 5).

- [ ] **Step 7: Document config in `.env.example`**

Append to `.env.example`:

```bash
# --- LDAP authentication (optional; off by default) ---
LDAP_ENABLED=false
LDAP_SERVER_URI=ldaps://ldap.internal:636
LDAP_START_TLS=false
LDAP_CA_CERT_FILE=
LDAP_BIND_DN=cn=reader,dc=example,dc=com
LDAP_BIND_PASSWORD=
LDAP_BASE_DN=ou=people,dc=example,dc=com
LDAP_USER_FILTER=(&(objectClass=inetOrgPerson)(uid={uid}))
LDAP_ATTR_EMAIL=mail
LDAP_ATTR_DISPLAY_NAME=cn
INITIAL_ADMIN_USERNAME=admin
```

- [ ] **Step 8: Commit**

```bash
git add backend/pyproject.toml backend/app/config.py backend/app/ldap_auth.py backend/tests/test_ldap_auth.py .env.example
git commit -m "feat(auth): ldap3 search-then-bind authenticator + config"
```

---

### Task 3: Method-routed login + provisioning + config endpoint

**Files:**
- Modify: `backend/app/schemas.py` (`LoginRequest`, ~line 312)
- Modify: `backend/app/auth.py` (add `find_or_provision_ldap_user`)
- Modify: `backend/app/routers/auth.py` (login rewrite + `/config`)
- Test: `backend/tests/test_api_auth.py` (update + add)

**Interfaces:**
- Consumes: `LdapIdentity`, `get_authenticator` (Task 2); `User.username` (Task 1); existing `create_session`, `verify_password`, `_set_session_cookie`, `log_event`.
- Produces:
  - `LoginRequest{username: str, password: str, method: Literal["local","ldap"] = "ldap"}`.
  - `find_or_provision_ldap_user(db: Session, identity: LdapIdentity) -> User | None` in `app/auth.py`.
  - `GET /api/v1/auth/config -> {"ldap_enabled": bool}`.

- [ ] **Step 1: Update the login schema**

In `backend/app/schemas.py`, add `from typing import Literal` to the imports if absent, and replace `LoginRequest`:

```python
class LoginRequest(BaseModel):
    username: str
    password: str
    method: Literal["local", "ldap"] = "ldap"
```

- [ ] **Step 2: Write the provisioning helper's failing test**

In `backend/tests/test_api_auth.py`, add:

```python
def test_provision_creates_ldap_member(db_session):
    from app.auth import find_or_provision_ldap_user
    from app.ldap_auth import LdapIdentity
    user = find_or_provision_ldap_user(
        db_session, LdapIdentity(uid="jdoe", email="J@X.ch", display_name="John")
    )
    db_session.commit()
    assert user.username == "jdoe"
    assert user.email == "j@x.ch"
    assert user.auth_provider == "ldap"
    assert user.role == "member"
    assert user.password_hash is None


def test_provision_rejects_local_username_collision(db_session):
    from app.auth import find_or_provision_ldap_user, hash_password
    from app.ldap_auth import LdapIdentity
    from app.models import User
    db_session.add(User(username="jdoe", display_name="Local", auth_provider="local",
                        password_hash=hash_password("x")))
    db_session.commit()
    assert find_or_provision_ldap_user(
        db_session, LdapIdentity(uid="jdoe", email=None, display_name="J")
    ) is None
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_api_auth.py::test_provision_creates_ldap_member -v`
Expected: FAIL — `ImportError: cannot import name 'find_or_provision_ldap_user'`.

- [ ] **Step 4: Implement the provisioning helper**

In `backend/app/auth.py`, add (import `LdapIdentity` inside the function to avoid a circular import, and `select` is already imported):

```python
def find_or_provision_ldap_user(db: Session, identity) -> User | None:
    """Return the LDAP-backed User for this identity, creating it on first login.
    Returns None if the username is already taken by a non-LDAP account."""
    email = identity.email.strip().lower() if identity.email else None
    user = db.scalar(select(User).where(User.username == identity.uid))
    if user is not None:
        if user.auth_provider != "ldap":
            return None  # username owned by a local account — do not cross providers
        user.display_name = identity.display_name or user.display_name
        # Only adopt the directory email if it is free (email is unique).
        if email and not db.scalar(
            select(User.id).where(User.email == email, User.id != user.id)
        ):
            user.email = email
        return user
    if email and db.scalar(select(User.id).where(User.email == email)):
        email = None  # avoid violating the unique email constraint
    user = User(
        username=identity.uid,
        email=email,
        display_name=identity.display_name or identity.uid,
        password_hash=None,
        role="member",
        auth_provider="ldap",
    )
    db.add(user)
    db.flush()
    return user
```

- [ ] **Step 5: Run to verify the helper tests pass**

Run: `cd backend && python -m pytest tests/test_api_auth.py::test_provision_creates_ldap_member tests/test_api_auth.py::test_provision_rejects_local_username_collision -v`
Expected: PASS

- [ ] **Step 6: Rewrite the login router + add `/config`**

In `backend/app/routers/auth.py`:

Add imports:
```python
from app.auth import find_or_provision_ldap_user
from app.ldap_auth import get_authenticator, LdapAuthenticator
from app.config import settings  # already imported
```

Replace the `login` function body with:

```python
@router.post("/login", response_model=UserRead)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    authenticator: LdapAuthenticator = Depends(get_authenticator),
) -> User:
    username = payload.username.strip()
    user: User | None = None
    if payload.method == "local":
        candidate = db.scalar(select(User).where(User.username == username))
        if (
            candidate is not None
            and candidate.auth_provider == "local"
            and candidate.is_active
            and verify_password(payload.password, candidate.password_hash)
        ):
            user = candidate
    elif payload.method == "ldap" and settings.ldap_enabled:
        identity = authenticator.authenticate(username, payload.password)
        if identity is not None:
            resolved = find_or_provision_ldap_user(db, identity)
            if resolved is not None and resolved.is_active:
                user = resolved

    if user is None:
        log_event(
            db, actor=None, event_type="auth.login_failed",
            entity_type="auth", entity_label=username,
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    log_event(
        db, actor=user, event_type="auth.login",
        entity_type="auth", entity_id=user.id, entity_label=user.email or user.username,
    )
    token = create_session(db, user)  # commits, persisting the event + any provisioning atomically
    _set_session_cookie(response, token)
    return user


@router.get("/config")
def auth_config() -> dict:
    return {"ldap_enabled": settings.ldap_enabled}
```

- [ ] **Step 7: Update existing auth tests to username/method, add LDAP login tests**

In `backend/tests/test_api_auth.py`, update `_seed_user` to set a username and change login payloads. Replace the helper and the existing login/logout tests' payloads:

```python
def _seed_user(db, email="marco@x.ch", username="marco", password="secret123", **over):
    user = User(
        email=email,
        username=username,
        display_name=over.pop("display_name", "Marco"),
        password_hash=hash_password(password),
        **over,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
```

Change every `login` POST in this file from `json={"email": ..., "password": ...}` to `json={"username": "marco", "password": "secret123", "method": "local"}` (and the failure-case payloads to unknown usernames with `"method": "local"`). Then add LDAP-path tests using a dependency override:

```python
from app.ldap_auth import LdapIdentity, get_authenticator
from app.main import app


class _FakeAuth:
    def __init__(self, identity):
        self._identity = identity
    def authenticate(self, uid, password):
        return self._identity if password == "good" else None


def _use_ldap(identity, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "ldap_enabled", True)
    app.dependency_overrides[get_authenticator] = lambda: _FakeAuth(identity)


def test_ldap_login_provisions_and_authenticates(anon_client, db_session, monkeypatch):
    _use_ldap(LdapIdentity(uid="jdoe", email="jdoe@x.ch", display_name="John"), monkeypatch)
    try:
        resp = anon_client.post(
            "/api/v1/auth/login",
            json={"username": "jdoe", "password": "good", "method": "ldap"},
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "John"
        assert "kanban_session" in resp.cookies
    finally:
        app.dependency_overrides.pop(get_authenticator, None)


def test_ldap_login_bad_password_is_401(anon_client, db_session, monkeypatch):
    _use_ldap(LdapIdentity(uid="jdoe", email=None, display_name="J"), monkeypatch)
    try:
        resp = anon_client.post(
            "/api/v1/auth/login",
            json={"username": "jdoe", "password": "bad", "method": "ldap"},
        )
        assert resp.status_code == 401
        assert resp.json() == {"detail": "Invalid credentials"}
    finally:
        app.dependency_overrides.pop(get_authenticator, None)


def test_ldap_method_disabled_is_401(anon_client, db_session):
    resp = anon_client.post(
        "/api/v1/auth/login",
        json={"username": "jdoe", "password": "good", "method": "ldap"},
    )
    assert resp.status_code == 401  # ldap_enabled is False by default


def test_auth_config_reports_ldap_flag(anon_client):
    assert anon_client.get("/api/v1/auth/config").json() == {"ldap_enabled": False}
```

- [ ] **Step 8: Run the auth suite**

Run: `cd backend && python -m pytest tests/test_api_auth.py -v`
Expected: PASS (updated + new tests).

- [ ] **Step 9: Run the full backend suite (catch other login callers)**

Run: `cd backend && python -m pytest`
Expected: PASS. If `tests/test_authz.py` or `tests/test_audit_auth_users.py` post to `/login`, update those payloads to `{"username", "password", "method": "local"}` and re-run.

- [ ] **Step 10: Commit**

```bash
git add backend/app/schemas.py backend/app/auth.py backend/app/routers/auth.py backend/tests/
git commit -m "feat(auth): method-routed login (local/ldap) with auto-provisioning"
```

---

### Task 4: Frontend — username field, method toggle, config probe

**Files:**
- Modify: `frontend/src/api/client.ts` (`login`, ~line 243; add `getAuthConfig`)
- Modify: `frontend/src/components/LoginPage.tsx`
- Test: `frontend/src/api/client.auth.test.ts`, `frontend/src/components/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/auth/login {username,password,method}` and `GET /api/v1/auth/config` (Task 3).
- Produces: `login(username, password, method)`, `getAuthConfig(): Promise<{ldap_enabled: boolean}>`.

- [ ] **Step 1: Update the client login test**

In `frontend/src/api/client.auth.test.ts`, change the `login` call/assertions:

```typescript
    const user = await login("jdoe", "pw123456", "ldap");
    // ...
    expect(spy.mock.calls[0][0]).toBe("/api/v1/auth/login");
```
And update the rejection case to `login("jdoe", "bad", "local")`.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm test -- client.auth`
Expected: FAIL — `login` expects 2 args / type error.

- [ ] **Step 3: Update the client**

In `frontend/src/api/client.ts`, replace `login` and add `getAuthConfig`:

```typescript
export function login(
  username: string,
  password: string,
  method: "local" | "ldap",
): Promise<AuthUser> {
  return request<AuthUser>(`${API}/auth/login`, json({ username, password, method }), false);
}

export function getAuthConfig(): Promise<{ ldap_enabled: boolean }> {
  return request<{ ldap_enabled: boolean }>(`${API}/auth/config`, {}, false);
}
```

- [ ] **Step 4: Run to verify client test passes**

Run: `cd frontend && npm test -- client.auth`
Expected: PASS

- [ ] **Step 5: Write the LoginPage test**

Replace the relevant assertions in `frontend/src/components/LoginPage.test.tsx` so it drives a `username` field and (when ldap is enabled) a method toggle. Minimum coverage:

```typescript
// mock getAuthConfig -> { ldap_enabled: true } and login resolving to a user;
// assert a "Username" field renders, an "LDAP"/"Local" toggle is present,
// and submitting calls login(username, password, "ldap") by default.
```
Follow the existing test's mocking style for `../api/client`. Assert `login` is called with `("jdoe", "pw", "ldap")` on default submit, and with `"local"` after selecting the Local toggle.

- [ ] **Step 6: Run to verify failure**

Run: `cd frontend && npm test -- LoginPage`
Expected: FAIL — no username field / toggle.

- [ ] **Step 7: Rewrite LoginPage**

Replace `frontend/src/components/LoginPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getAuthConfig, login } from "../api/client";
import type { AuthUser } from "../types";
import { captionClass, inputClass } from "./ui";

type Method = "ldap" | "local";

export default function LoginPage({ onLoggedIn }: { onLoggedIn: (user: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<Method>("ldap");
  const [ldapEnabled, setLdapEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAuthConfig()
      .then((c) => {
        setLdapEnabled(c.ldap_enabled);
        setMethod(c.ldap_enabled ? "ldap" : "local");
      })
      .catch(() => {
        setLdapEnabled(false);
        setMethod("local");
      });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await login(username.trim(), password, method));
    } catch {
      setError("Invalid username or password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm ring-1 ring-black/5"
      >
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
        <p className="mb-6 mt-0.5 text-sm text-gray-500">Sign in to your workspace.</p>

        {ldapEnabled && (
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
            {(["ldap", "local"] as Method[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  method === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                }`}
              >
                {m === "ldap" ? "LDAP" : "Local"}
              </button>
            ))}
          </div>
        )}

        <label className="mb-3 block">
          <span className={`mb-1 block ${captionClass}`}>Username</span>
          <input
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={`w-full ${inputClass}`}
          />
        </label>
        <label className="mb-5 block">
          <span className={`mb-1 block ${captionClass}`}>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`w-full ${inputClass}`}
          />
        </label>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 8: Run frontend tests**

Run: `cd frontend && npm test -- LoginPage client.auth`
Expected: PASS

- [ ] **Step 9: Full frontend suite + typecheck**

Run: `cd frontend && npm test && npm run build`
Expected: PASS (build = tsc typecheck clean).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/components/LoginPage.tsx frontend/src/api/client.auth.test.ts frontend/src/components/LoginPage.test.tsx
git commit -m "feat(auth): login page username field + LDAP/Local method toggle"
```

---

## Final verification (whole feature)

- [ ] Backend: `cd backend && python -m pytest` → all green.
- [ ] Frontend: `cd frontend && npm test && npm run build` → all green.
- [ ] Migration re-confirmed on Postgres: `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` → clean.
- [ ] Manual smoke in the Docker stack: with `LDAP_ENABLED=false`, the login page shows only Username/Password and the bootstrap admin logs in via `method=local`. (LDAP end-to-end is verified against the already-deployed OpenLDAP by setting the `LDAP_*` env vars and logging in with a real `uid`.)
```
