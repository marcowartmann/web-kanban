# Authentication & User Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the whole app behind DB-backed login with admin/member roles and server-side sessions in an HttpOnly cookie, architected so OIDC can slot in later.

**Architecture:** New `users` + `user_sessions` tables (migration `0008`). An `app/auth.py` module owns bcrypt hashing, opaque session tokens (sha256-stored), and the `get_current_user` / `require_user` / `require_admin` FastAPI dependencies. An auth router (login/logout/me/password) and an admin-only users router are added; every existing router is registered behind `require_user`, with `require_admin` on admin-surface mutations. The SPA gates itself with an `AuthProvider` (boot probe `GET /api/auth/me`, full-screen login page, 401 flip-back), a header user menu, and a Users admin section.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic + bcrypt (backend); React 18 + TS + Tailwind + vitest (frontend); Docker Compose.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-auth-sessions-design.md`. Work on branch `feat/auth-sessions` off `main`.
- Migration is `0008_users_sessions.py`, `revision = "0008"`, `down_revision = "0007"`.
- `users` columns: `id` PK, `email` String(255) unique NOT NULL (stored lowercase), `display_name` String(120) NOT NULL, `password_hash` String(255) NULLABLE, `role` String(16) NOT NULL default `member`, `is_active` Boolean NOT NULL default true, `auth_provider` String(16) NOT NULL default `local`, `created_at` DateTime server_default now().
- `user_sessions` columns: `id` PK, `token_hash` String(64) unique NOT NULL, `user_id` FK `users.id` ON DELETE CASCADE NOT NULL, `created_at` DateTime server_default now(), `expires_at` DateTime NOT NULL.
- Raw session token: `secrets.token_urlsafe(32)`; only `hashlib.sha256(token.encode()).hexdigest()` is stored.
- Cookie: name `kanban_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` = TTL; `Secure` only when `settings.cookie_secure`. Same token accepted as `Authorization: Bearer <token>`.
- Session TTL 14 days, sliding: extend to `now + TTL` when less than half remains. Naive-UTC datetimes via a `utcnow()` helper (`datetime.now(timezone.utc).replace(tzinfo=None)`).
- Roles are exactly `"admin" | "member"` (Pydantic `Literal`). Passwords `Field(min_length=8, max_length=72)`.
- Open endpoints (no auth): `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/logout` (idempotent). Everything else requires auth; admin-only: `/api/users/*`, `POST /api/import`, lanes mutations, teams/team_members/planning_intervals/capacities mutations.
- Login failures (unknown email, wrong password, inactive) all return the identical 401 `{"detail": "Invalid credentials"}`. Email matching case-insensitive.
- No `DELETE /api/users/...` route exists. Admins cannot demote or deactivate themselves (422).
- Bootstrap admin runs only when `settings.bootstrap_admin` is true (env `BOOTSTRAP_ADMIN`); dev defaults `admin@example.com` / `admin` / `Admin` in docker-compose.
- New backend dependency: `bcrypt>=4.1` (direct, NOT passlib).
- ENV NOTE (backend tasks): the running backend container does NOT bind-mount `backend/app`/`backend/alembic`/`backend/tests`, and pytest/httpx/bcrypt are not in the image until rebuild. Before running backend tests in the container:
  `docker compose exec -T backend sh -c 'rm -rf /app/app /app/alembic /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/alembic backend:/app/alembic && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend pip install -q "pytest>=8.2" "httpx>=0.27" "bcrypt>=4.1"`
  Re-copy after every edit. Host files are the source of truth for commits.

---

### Task 1: `User` + `UserSession` models, migration `0008`, config, bcrypt dep

**Files:**
- Modify: `backend/app/models.py` (append after `PlanningInterval`)
- Modify: `backend/app/config.py`
- Modify: `backend/pyproject.toml` (add `bcrypt>=4.1` to `dependencies`)
- Create: `backend/alembic/versions/0008_users_sessions.py`
- Test: `backend/tests/test_auth_models.py`

**Interfaces:**
- Produces: `User`, `UserSession` ORM models; settings fields `session_ttl_days: int = 14`, `cookie_secure: bool = False`, `bootstrap_admin: bool = False`, `initial_admin_email: str = "admin@example.com"`, `initial_admin_password: str = "admin"`, `initial_admin_name: str = "Admin"`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_auth_models.py`:

```python
from datetime import datetime, timedelta, timezone

from app.models import User, UserSession


def _utcnow() -> datetime:
    # naive UTC, matching the DateTime columns (datetime.utcnow() is deprecated)
    return datetime.now(timezone.utc).replace(tzinfo=None)


def test_user_and_session_roundtrip(db_session):
    user = User(email="a@b.ch", display_name="A", password_hash="x", role="admin")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert user.id is not None
    assert user.is_active is True
    assert user.auth_provider == "local"

    sess = UserSession(
        token_hash="h" * 64,
        user_id=user.id,
        expires_at=_utcnow() + timedelta(days=14),
    )
    db_session.add(sess)
    db_session.commit()
    db_session.refresh(sess)
    assert sess.id is not None
    assert sess.created_at is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/tests' && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_auth_models.py -q`
Expected: FAIL — `ImportError: cannot import name 'User'`.

- [ ] **Step 3: Add the models**

In `backend/app/models.py`, append after the `PlanningInterval` class (all imports already present):

```python
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)  # stored lowercase
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255))  # None for future IdP users
    role: Mapped[str] = mapped_column(String(16), default="member")  # 'admin' | 'member'
    is_active: Mapped[bool] = mapped_column(default=True)
    auth_provider: Mapped[str] = mapped_column(String(16), default="local")  # 'oidc' later
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # sha256 hex
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column()
```

- [ ] **Step 4: Extend settings + dependency**

`backend/app/config.py` — add fields to `Settings`:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://kanban:kanban@localhost:5432/kanban"
    cors_origins: list[str] = ["http://localhost:5173"]

    session_ttl_days: int = 14
    cookie_secure: bool = False
    bootstrap_admin: bool = False
    initial_admin_email: str = "admin@example.com"
    initial_admin_password: str = "admin"
    initial_admin_name: str = "Admin"
```

`backend/pyproject.toml` — append to the `dependencies` list: `"bcrypt>=4.1",`

- [ ] **Step 5: Create the migration**

Create `backend/alembic/versions/0008_users_sessions.py`:

```python
"""users and server-side sessions

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("role", sa.String(16), nullable=False, server_default="member"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("auth_provider", sa.String(16), nullable=False, server_default="local"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("user_sessions")
    op.drop_table("users")
```

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/app /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_auth_models.py -q`
Expected: PASS (1 passed).

- [ ] **Step 7: Verify the migration applies on Postgres**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/alembic' && docker compose cp ./backend/alembic backend:/app/alembic && docker compose exec -T backend alembic upgrade head && docker compose exec -T backend alembic current`
Expected: `0008 (head)`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/app/config.py backend/pyproject.toml backend/alembic/versions/0008_users_sessions.py backend/tests/test_auth_models.py
git commit -m "feat(backend): users + sessions models, migration 0008, auth settings"
```

---

### Task 2: `app/auth.py` — hashing, sessions, current-user dependencies

**Files:**
- Create: `backend/app/auth.py`
- Test: `backend/tests/test_auth_core.py`

**Interfaces:**
- Consumes: `User`, `UserSession` (Task 1), `settings`.
- Produces (used by Tasks 3–6):
  - `hash_password(password: str) -> str`, `verify_password(password: str, password_hash: str | None) -> bool`
  - `utcnow() -> datetime` (naive UTC)
  - `create_session(db: Session, user: User) -> str` (returns raw token)
  - `resolve_session_user(db: Session, token: str | None) -> User | None` (expiry + is_active + sliding renewal)
  - `request_token(request: Request) -> str | None` (cookie `kanban_session`, else `Authorization: Bearer`)
  - `get_current_user(request, db) -> User | None` (dependency; override point for tests)
  - `require_user(...) -> User` (401), `require_admin(...) -> User` (403)
  - `SESSION_COOKIE = "kanban_session"`, `session_ttl() -> timedelta`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_auth_core.py`:

```python
import hashlib
from datetime import timedelta

from app.auth import (
    create_session,
    hash_password,
    resolve_session_user,
    utcnow,
    verify_password,
)
from app.models import User, UserSession


def _user(db, **over):
    defaults = dict(email="u@x.ch", display_name="U", password_hash=hash_password("secret123"))
    defaults.update(over)
    user = User(**defaults)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_password_hash_roundtrip():
    hashed = hash_password("secret123")
    assert hashed != "secret123"
    assert verify_password("secret123", hashed)
    assert not verify_password("wrong", hashed)
    assert not verify_password("anything", None)  # IdP users have no hash


def test_create_session_stores_sha256_only(db_session):
    user = _user(db_session)
    token = create_session(db_session, user)
    assert len(token) >= 40
    sess = db_session.query(UserSession).one()
    assert sess.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert sess.user_id == user.id


def test_resolve_session_user(db_session):
    user = _user(db_session)
    token = create_session(db_session, user)
    assert resolve_session_user(db_session, token).id == user.id
    assert resolve_session_user(db_session, "nonsense") is None
    assert resolve_session_user(db_session, None) is None


def test_resolve_rejects_expired_and_inactive(db_session):
    user = _user(db_session)
    token = create_session(db_session, user)
    sess = db_session.query(UserSession).one()
    sess.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    assert resolve_session_user(db_session, token) is None

    token2 = create_session(db_session, user)
    user.is_active = False
    db_session.commit()
    assert resolve_session_user(db_session, token2) is None


def test_sliding_renewal_extends_when_half_elapsed(db_session):
    user = _user(db_session)
    token = create_session(db_session, user)
    sess = db_session.query(UserSession).filter_by(user_id=user.id).one()
    sess.expires_at = utcnow() + timedelta(days=1)  # far less than half of 14d left
    db_session.commit()
    assert resolve_session_user(db_session, token) is not None
    db_session.refresh(sess)
    assert sess.expires_at > utcnow() + timedelta(days=13)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/tests' && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_auth_core.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.auth'`.

- [ ] **Step 3: Implement `backend/app/auth.py`**

```python
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User, UserSession

SESSION_COOKIE = "kanban_session"


def session_ttl() -> timedelta:
    return timedelta(days=settings.session_ttl_days)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:  # IdP-managed accounts have no local password
        return False
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: Session, user: User) -> str:
    # Opportunistic cleanup of this user's expired sessions.
    db.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id, UserSession.expires_at < utcnow()
        )
    )
    token = secrets.token_urlsafe(32)
    db.add(
        UserSession(
            token_hash=_hash_token(token),
            user_id=user.id,
            expires_at=utcnow() + session_ttl(),
        )
    )
    db.commit()
    return token


def resolve_session_user(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == _hash_token(token)))
    if sess is None or sess.expires_at < utcnow():
        return None
    user = db.get(User, sess.user_id)
    if user is None or not user.is_active:
        return None
    # Sliding TTL: extend when less than half the window remains.
    if sess.expires_at - utcnow() < session_ttl() / 2:
        sess.expires_at = utcnow() + session_ttl()
        db.commit()
    return user


def request_token(request: Request) -> str | None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        return token
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header.removeprefix("Bearer ").strip()
    return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    return resolve_session_user(db, request_token(request))


def require_user(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/app /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_auth_core.py -q`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth.py backend/tests/test_auth_core.py
git commit -m "feat(backend): auth core — bcrypt hashing, opaque sessions, user dependencies"
```

---

### Task 3: Auth schemas + `/api/auth` router (login/logout/me/password)

**Files:**
- Modify: `backend/app/schemas.py` (append)
- Create: `backend/app/routers/auth.py`
- Modify: `backend/app/main.py` (register auth router only)
- Modify: `backend/tests/conftest.py` (add `anon_client` fixture)
- Test: `backend/tests/test_api_auth.py`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/me/password`; schemas `UserRead {id,email,display_name,role,is_active}`, `LoginRequest {email,password}`, `PasswordChange {current_password,new_password}`; conftest fixture `anon_client` (get_db override only).

- [ ] **Step 1: Add the `anon_client` fixture**

Append to `backend/tests/conftest.py` (same body as today's `client`; `client` itself changes in Task 5):

```python
@pytest.fixture()
def anon_client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_api_auth.py`:

```python
from app.auth import create_session, hash_password
from app.models import User, UserSession


def _seed_user(db, email="marco@x.ch", password="secret123", **over):
    user = User(
        email=email,
        display_name=over.pop("display_name", "Marco"),
        password_hash=hash_password(password),
        **over,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_login_sets_cookie_and_me_roundtrip(anon_client, db_session):
    _seed_user(db_session)
    resp = anon_client.post(
        "/api/auth/login", json={"email": "Marco@X.ch", "password": "secret123"}
    )
    assert resp.status_code == 200
    assert resp.json()["email"] == "marco@x.ch"
    assert "kanban_session" in resp.cookies
    me = anon_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["display_name"] == "Marco"


def test_login_failures_are_identical_401(anon_client, db_session):
    _seed_user(db_session)
    _seed_user(db_session, email="off@x.ch", is_active=False)
    for payload in (
        {"email": "nobody@x.ch", "password": "secret123"},
        {"email": "marco@x.ch", "password": "wrong-password"},
        {"email": "off@x.ch", "password": "secret123"},
    ):
        resp = anon_client.post("/api/auth/login", json=payload)
        assert resp.status_code == 401
        assert resp.json() == {"detail": "Invalid credentials"}


def test_me_requires_auth(anon_client):
    assert anon_client.get("/api/auth/me").status_code == 401


def test_bearer_header_works(anon_client, db_session):
    user = _seed_user(db_session)
    token = create_session(db_session, user)
    resp = anon_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_logout_revokes_and_is_idempotent(anon_client, db_session):
    _seed_user(db_session)
    anon_client.post("/api/auth/login", json={"email": "marco@x.ch", "password": "secret123"})
    assert anon_client.post("/api/auth/logout").status_code == 204
    assert anon_client.get("/api/auth/me").status_code == 401
    assert db_session.query(UserSession).count() == 0
    assert anon_client.post("/api/auth/logout").status_code == 204  # no cookie: still 204


def test_password_change_revokes_other_sessions(anon_client, db_session):
    user = _seed_user(db_session)
    other_token = create_session(db_session, user)
    anon_client.post("/api/auth/login", json={"email": "marco@x.ch", "password": "secret123"})
    resp = anon_client.patch(
        "/api/auth/me/password",
        json={"current_password": "secret123", "new_password": "brandnew99"},
    )
    assert resp.status_code == 204
    assert anon_client.get("/api/auth/me").status_code == 200  # current session survives
    assert (
        anon_client.get("/api/auth/me", headers={"Authorization": f"Bearer {other_token}"}).status_code
        == 401
    )
    wrong = anon_client.patch(
        "/api/auth/me/password",
        json={"current_password": "nope", "new_password": "whatever99"},
    )
    assert wrong.status_code == 401
    short = anon_client.patch(
        "/api/auth/me/password",
        json={"current_password": "brandnew99", "new_password": "short"},
    )
    assert short.status_code == 422
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/tests' && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_auth.py -q`
Expected: FAIL — 404s (router not registered).

- [ ] **Step 4: Add schemas**

Append to `backend/app/schemas.py` (add `from typing import Literal` to the imports at the top if not already present):

```python
class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    display_name: str
    role: str
    is_active: bool


class LoginRequest(BaseModel):
    email: str
    password: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)
```

- [ ] **Step 5: Create `backend/app/routers/auth.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import (
    SESSION_COOKIE,
    create_session,
    hash_password,
    require_user,
    request_token,
    session_ttl,
    verify_password,
    _hash_token,
)
from app.config import settings
from app.db import get_db
from app.models import User, UserSession
from app.schemas import LoginRequest, PasswordChange, UserRead

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(session_ttl().total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.post("/login", response_model=UserRead)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> User:
    user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
    # Identical 401 for unknown email / wrong password / inactive account.
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_session(db, user)
    _set_session_cookie(response, token)
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    token = request_token(request)
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == _hash_token(token)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(require_user)) -> User:
    return user


@router.patch("/me/password", status_code=204)
def change_my_password(
    payload: PasswordChange,
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> None:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    token = request_token(request)
    # Revoke every other session of this user; the current one stays valid.
    stmt = delete(UserSession).where(UserSession.user_id == user.id)
    if token:
        stmt = stmt.where(UserSession.token_hash != _hash_token(token))
    db.execute(stmt)
    db.commit()
```

- [ ] **Step 6: Register in `backend/app/main.py`**

Add `auth` to the routers import line and register it first:

```python
from app.routers import auth, imports, items, boards, teams, team_members, capacities, links, planning_intervals

app.include_router(auth.router)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/app /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_auth.py -q`
Expected: PASS (6 passed). Then full suite: `docker compose exec -T backend python -m pytest -q` — all pass (existing endpoints are still ungated).

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/auth.py backend/app/main.py backend/tests/conftest.py backend/tests/test_api_auth.py
git commit -m "feat(backend): /api/auth login, logout, me, password change"
```

---

### Task 4: Users admin router (`/api/users`)

**Files:**
- Modify: `backend/app/schemas.py` (append)
- Create: `backend/app/routers/users.py`
- Modify: `backend/app/main.py` (register)
- Test: `backend/tests/test_api_users.py`

**Interfaces:**
- Consumes: `require_admin`, `get_current_user`, `hash_password` (Task 2), `UserRead` (Task 3).
- Produces: `GET /api/users`, `POST /api/users`, `PATCH /api/users/{user_id}`; schemas `UserCreate {email, display_name, password, role}`, `UserUpdate {display_name?, role?, is_active?, password?}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_api_users.py`:

```python
from app.auth import create_session, get_current_user, hash_password
from app.main import app
from app.models import User, UserSession


def _seed(db, email, role="member", **over):
    user = User(
        email=email,
        display_name=over.pop("display_name", email.split("@")[0]),
        password_hash=hash_password("secret123"),
        role=role,
        **over,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def test_admin_crud_and_duplicate(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    _as(admin)
    created = anon_client.post(
        "/api/users",
        json={"email": "New@X.ch", "display_name": "New", "password": "longenough1", "role": "member"},
    )
    assert created.status_code == 201
    assert created.json()["email"] == "new@x.ch"  # lowercased
    dupe = anon_client.post(
        "/api/users",
        json={"email": "new@x.ch", "display_name": "N2", "password": "longenough1", "role": "member"},
    )
    assert dupe.status_code == 409
    listed = anon_client.get("/api/users").json()
    assert [u["email"] for u in listed] == sorted(
        [u["email"] for u in listed], key=str.lower
    ) or len(listed) == 2

    target_id = created.json()["id"]
    patched = anon_client.patch(f"/api/users/{target_id}", json={"role": "admin", "is_active": False})
    assert patched.status_code == 200
    assert patched.json()["role"] == "admin"
    assert patched.json()["is_active"] is False


def test_admin_password_reset_revokes_sessions(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")
    create_session(db_session, member)
    _as(admin)
    resp = anon_client.patch(f"/api/users/{member.id}", json={"password": "resetpass1"})
    assert resp.status_code == 200
    assert db_session.query(UserSession).filter_by(user_id=member.id).count() == 0


def test_self_lockout_guard(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    _as(admin)
    assert anon_client.patch(f"/api/users/{admin.id}", json={"role": "member"}).status_code == 422
    assert anon_client.patch(f"/api/users/{admin.id}", json={"is_active": False}).status_code == 422
    ok = anon_client.patch(f"/api/users/{admin.id}", json={"display_name": "Boss"})
    assert ok.status_code == 200


def test_member_gets_403(anon_client, db_session):
    member = _seed(db_session, "m@x.ch")
    _as(member)
    assert anon_client.get("/api/users").status_code == 403
    assert (
        anon_client.post(
            "/api/users",
            json={"email": "x@x.ch", "display_name": "X", "password": "longenough1", "role": "member"},
        ).status_code
        == 403
    )


def test_unknown_user_404(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    _as(admin)
    assert anon_client.patch("/api/users/999", json={"display_name": "X"}).status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/tests' && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_users.py -q`
Expected: FAIL — 404s (router not registered).

- [ ] **Step 3: Add schemas**

Append to `backend/app/schemas.py`:

```python
class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=72)
    role: Literal["admin", "member"] = "member"


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    role: Literal["admin", "member"] | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=72)
```

- [ ] **Step 4: Create `backend/app/routers/users.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth import hash_password, require_admin
from app.db import get_db
from app.models import User, UserSession
from app.schemas import UserCreate, UserRead, UserUpdate

router = APIRouter(
    prefix="/api/users", tags=["users"], dependencies=[Depends(require_admin)]
)


def _get_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db)) -> list[User]:
    return list(db.scalars(select(User).order_by(User.display_name)))


@router.post("", response_model=UserRead, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db)) -> User:
    email = payload.email.strip().lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status_code=409, detail="Email already in use")
    user = User(
        email=email,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> User:
    user = _get_or_404(db, user_id)
    changes = payload.model_dump(exclude_unset=True)
    if user.id == current.id and (
        changes.get("role") == "member" or changes.get("is_active") is False
    ):
        raise HTTPException(status_code=422, detail="Admins cannot demote or deactivate themselves")
    password = changes.pop("password", None)
    for key, value in changes.items():
        setattr(user, key, value)
    if password is not None:
        user.password_hash = hash_password(password)
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
    db.refresh(user)
    return user
```

- [ ] **Step 5: Register in `backend/app/main.py`**

Add `users` to the routers import line and `app.include_router(users.router)` after the others.

- [ ] **Step 6: Run tests to verify they pass**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/app /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_users.py -q`
Expected: PASS (5 passed).

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/users.py backend/app/main.py backend/tests/test_api_users.py
git commit -m "feat(backend): admin users API (list/create/update, self-lockout guard)"
```

---

### Task 5: Gate every router; admin gates on mutations; auth-aware test fixtures

**Files:**
- Modify: `backend/app/main.py` (registration with dependencies)
- Modify: `backend/app/routers/teams.py`, `team_members.py`, `planning_intervals.py`, `capacities.py`, `boards.py`, `imports.py` (admin gates on mutating decorators)
- Modify: `backend/tests/conftest.py` (`client` becomes admin-authenticated; add `member_client`)
- Test: `backend/tests/test_authz.py`

**Interfaces:**
- Consumes: `require_user`, `require_admin`, `get_current_user` (Task 2).
- Produces: conftest fixtures — `client` (admin), `member_client` (member), `anon_client` (no auth, from Task 3). All later tasks and all existing tests rely on `client` being admin.

- [ ] **Step 1: Update `backend/tests/conftest.py`**

Replace the `client` fixture and add `member_client` (keep `db_session` and `anon_client` as they are):

```python
from app.auth import get_current_user
from app.models import User


def _make_client(db_session, role):
    user = User(
        email=f"test-{role}@fixture.local",
        display_name=f"Test {role.capitalize()}",
        password_hash=None,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture()
def client(db_session):
    with _make_client(db_session, "admin") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def member_client(db_session):
    with _make_client(db_session, "member") as c:
        yield c
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Write the failing authz tests**

Create `backend/tests/test_authz.py`:

```python
import io


def test_anonymous_gets_401_everywhere(anon_client):
    assert anon_client.get("/api/items").status_code == 401
    assert anon_client.get("/api/boards").status_code == 401
    assert anon_client.get("/api/teams").status_code == 401
    assert anon_client.get("/api/health").status_code == 200  # stays open


def test_member_can_work_with_items_and_read_masters(member_client):
    created = member_client.post("/api/items", json={"kind": "feature", "title": "F"})
    assert created.status_code == 201
    assert member_client.get("/api/teams").status_code == 200
    assert member_client.get("/api/planning-intervals").status_code == 200
    assert member_client.get("/api/capacities").status_code == 200
    assert member_client.get("/api/boards").status_code == 200


def test_member_blocked_from_admin_mutations(member_client):
    assert member_client.post("/api/teams", json={"name": "T"}).status_code == 403
    assert member_client.post("/api/team-members", json={"name": "M"}).status_code == 403
    assert member_client.post("/api/planning-intervals", json={"name": "PI9"}).status_code == 403
    assert (
        member_client.put(
            "/api/capacities",
            json={"member_id": 1, "planning_interval": "PI", "iteration": 1, "points": 1},
        ).status_code
        == 403
    )
    csv = io.BytesIO(b"Title,Type\n")
    assert (
        member_client.post("/api/import", files={"file": ("x.csv", csv, "text/csv")}).status_code
        == 403
    )


def test_member_blocked_from_lane_mutations(member_client):
    # The require_admin dependency runs BEFORE the handler, so even a
    # nonexistent board id yields 403 for members — no board setup needed.
    resp = member_client.post("/api/boards/999/lanes", json={"name": "X"})
    assert resp.status_code == 403


def test_admin_can_mutate_masters(client):
    assert client.post("/api/teams", json={"name": "T"}).status_code == 201
    assert client.post("/api/planning-intervals", json={"name": "PI9"}).status_code == 201
```

Never use `member_client` and `client` in the same test — both override the
same `get_current_user` key, so whichever fixture initializes last wins for
ALL requests in that test.

- [ ] **Step 3: Run tests to verify they fail**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/tests' && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_authz.py -q`
Expected: FAIL — anonymous requests return 200 (nothing gated yet), member mutations return 2xx.

- [ ] **Step 4: Gate the routers**

`backend/app/main.py` — register all non-auth routers behind `require_user`:

```python
from fastapi import Depends, FastAPI
from app.auth import require_user
from app.routers import auth, imports, items, boards, teams, team_members, capacities, links, planning_intervals, users

app.include_router(auth.router)
for protected in (
    imports.router,
    items.router,
    boards.router,
    teams.router,
    team_members.router,
    capacities.router,
    links.router,
    planning_intervals.router,
    users.router,
):
    app.include_router(protected, dependencies=[Depends(require_user)])
```

Then add `dependencies=[Depends(require_admin)]` to these route decorators (import `from app.auth import require_admin` plus `Depends` where missing in each file):

- `teams.py`: `@router.post(..., dependencies=[Depends(require_admin)])` and `@router.delete(...)` likewise.
- `team_members.py`: POST + DELETE.
- `planning_intervals.py`: POST + DELETE.
- `capacities.py`: PUT.
- `boards.py`: `POST /boards/{board_id}/lanes`, `PATCH /lanes/{lane_id}`, `DELETE /lanes/{lane_id}`, `PUT /boards/{board_id}/lanes/order`.
- `imports.py`: `POST /import`.

Example (teams.py):

```python
from app.auth import require_admin

@router.post("", response_model=TeamRead, status_code=201, dependencies=[Depends(require_admin)])
def create_team(payload: TeamCreate, db: Session = Depends(get_db)) -> Team:
    ...

@router.delete("/{team_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_team(team_id: int, db: Session = Depends(get_db)) -> None:
    ...
```

- [ ] **Step 5: Run the FULL suite**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/app /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest -q`
Expected: ALL pass — the new authz tests plus every pre-existing test (now running as the fixture admin). If an existing test fails with 401/403, its fixture wiring is wrong — fix the fixture, never weaken the gate.

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py backend/app/routers backend/tests/conftest.py backend/tests/test_authz.py
git commit -m "feat(backend): require auth on all APIs, admin gates on master-data mutations"
```

---

### Task 6: Bootstrap initial admin + compose env

**Files:**
- Modify: `backend/app/auth.py` (add `ensure_initial_admin`)
- Modify: `backend/app/main.py` (lifespan)
- Modify: `docker-compose.yml` (backend env)
- Test: `backend/tests/test_bootstrap.py`

**Interfaces:**
- Consumes: `settings` (Task 1), `hash_password` (Task 2).
- Produces: `ensure_initial_admin(db: Session) -> None` (idempotent).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_bootstrap.py`:

```python
from app.auth import ensure_initial_admin, verify_password
from app.config import settings
from app.models import User


def test_seeds_admin_once_into_empty_db(db_session):
    ensure_initial_admin(db_session)
    users = db_session.query(User).all()
    assert len(users) == 1
    admin = users[0]
    assert admin.email == settings.initial_admin_email
    assert admin.role == "admin"
    assert verify_password(settings.initial_admin_password, admin.password_hash)

    ensure_initial_admin(db_session)  # idempotent
    assert db_session.query(User).count() == 1


def test_noop_when_users_exist(db_session):
    db_session.add(User(email="x@x.ch", display_name="X", password_hash=None))
    db_session.commit()
    ensure_initial_admin(db_session)
    assert db_session.query(User).count() == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/tests' && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_bootstrap.py -q`
Expected: FAIL — `ImportError: cannot import name 'ensure_initial_admin'`.

- [ ] **Step 3: Implement**

Append to `backend/app/auth.py`:

```python
def ensure_initial_admin(db: Session) -> None:
    """Seed the first admin from settings. Idempotent; no-op once any user exists."""
    if db.scalar(select(User.id).limit(1)) is not None:
        return
    db.add(
        User(
            email=settings.initial_admin_email.strip().lower(),
            display_name=settings.initial_admin_name,
            password_hash=hash_password(settings.initial_admin_password),
            role="admin",
        )
    )
    db.commit()
```

In `backend/app/main.py`, add a lifespan (runs only when flagged, so tests and
tools never touch a real DB at import):

```python
import logging
from contextlib import asynccontextmanager

from app.auth import ensure_initial_admin, require_user
from app.db import SessionLocal


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.bootstrap_admin:
        with SessionLocal() as db:
            ensure_initial_admin(db)
            logging.getLogger("uvicorn").info(
                "auth bootstrap: initial admin is %s", settings.initial_admin_email
            )
    yield


app = FastAPI(title="SAFe Kanban API", lifespan=lifespan)
```

In `docker-compose.yml`, extend the backend `environment` block:

```yaml
    environment:
      DATABASE_URL: postgresql+psycopg://${POSTGRES_USER:-kanban}:${POSTGRES_PASSWORD:-kanban}@db:5432/${POSTGRES_DB:-kanban}
      BOOTSTRAP_ADMIN: "true"
      # Dev defaults — override all three in any real deployment.
      INITIAL_ADMIN_EMAIL: ${INITIAL_ADMIN_EMAIL:-admin@example.com}
      INITIAL_ADMIN_PASSWORD: ${INITIAL_ADMIN_PASSWORD:-admin}
      INITIAL_ADMIN_NAME: ${INITIAL_ADMIN_NAME:-Admin}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/app /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_bootstrap.py -q`
Expected: PASS (2 passed). Then the full suite once: `docker compose exec -T backend python -m pytest -q` — all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth.py backend/app/main.py docker-compose.yml backend/tests/test_bootstrap.py
git commit -m "feat(backend): env-gated initial admin bootstrap"
```

---

### Task 7: Frontend auth foundation — types, client, AuthProvider, LoginPage

**Files:**
- Modify: `frontend/src/types.ts` (append `AuthUser`)
- Modify: `frontend/src/api/client.ts` (401 handler + auth/user fns)
- Create: `frontend/src/auth/AuthContext.tsx`
- Create: `frontend/src/components/LoginPage.tsx`
- Modify: `frontend/src/main.tsx` (wrap in `AuthProvider`)
- Test: `frontend/src/api/client.auth.test.ts`, `frontend/src/components/LoginPage.test.tsx`, `frontend/src/auth/AuthContext.test.tsx`

**Interfaces:**
- Produces:
  - `interface AuthUser { id: number; email: string; display_name: string; role: "admin" | "member"; is_active: boolean }`
  - client: `login(email, password): Promise<AuthUser>`, `logout(): Promise<void>`, `getMe(): Promise<AuthUser>`, `changeMyPassword(current_password, new_password): Promise<void>`, `listUsers(): Promise<AuthUser[]>`, `createUser(payload): Promise<AuthUser>`, `updateUser(id, payload): Promise<AuthUser>`, `setUnauthorizedHandler(cb: (() => void) | null): void`
  - `AuthProvider` (gates children), `useAuth(): { user: AuthUser; setUser: (u: AuthUser | null) => void }`
  - `LoginPage({ onLoggedIn: (u: AuthUser) => void })`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/api/client.auth.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeMyPassword,
  createUser,
  getMe,
  listUsers,
  login,
  logout,
  setUnauthorizedHandler,
  updateUser,
} from "./client";

function mockFetch(status: number, body: unknown) {
  const spy = vi.fn().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe("auth client", () => {
  it("login posts credentials", async () => {
    const spy = mockFetch(200, { id: 1, email: "a@b.ch", display_name: "A", role: "admin", is_active: true });
    const user = await login("a@b.ch", "pw123456");
    expect(user.role).toBe("admin");
    expect(spy.mock.calls[0][0]).toBe("/api/auth/login");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ email: "a@b.ch", password: "pw123456" });
  });

  it("login 401 does NOT trigger the unauthorized handler", async () => {
    mockFetch(401, "Invalid credentials");
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(login("a@b.ch", "bad")).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("a 401 on a normal call triggers the unauthorized handler", async () => {
    mockFetch(401, "Not authenticated");
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(listUsers()).rejects.toThrow();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("logout, me, password, users hit the right URLs", async () => {
    const spy = mockFetch(204, "");
    await logout();
    expect(spy.mock.calls[0][0]).toBe("/api/auth/logout");
    expect(spy.mock.calls[0][1]?.method).toBe("POST");

    mockFetch(200, { id: 1, email: "a@b.ch", display_name: "A", role: "member", is_active: true });
    expect((await getMe()).id).toBe(1);

    const pw = mockFetch(204, "");
    await changeMyPassword("old12345", "new12345");
    expect(pw.mock.calls[0][0]).toBe("/api/auth/me/password");
    expect(pw.mock.calls[0][1]?.method).toBe("PATCH");

    const cu = mockFetch(201, { id: 2, email: "x@x.ch", display_name: "X", role: "member", is_active: true });
    await createUser({ email: "x@x.ch", display_name: "X", password: "pw123456", role: "member" });
    expect(cu.mock.calls[0][0]).toBe("/api/users");

    const uu = mockFetch(200, { id: 2, email: "x@x.ch", display_name: "X", role: "admin", is_active: true });
    await updateUser(2, { role: "admin" });
    expect(uu.mock.calls[0][0]).toBe("/api/users/2");
    expect(uu.mock.calls[0][1]?.method).toBe("PATCH");
  });
});
```

Create `frontend/src/components/LoginPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import LoginPage from "./LoginPage";

afterEach(() => vi.restoreAllMocks());

const user = { id: 1, email: "a@b.ch", display_name: "A", role: "admin", is_active: true } as const;

it("submits credentials and reports the user", async () => {
  const login = vi.spyOn(client, "login").mockResolvedValue(user as never);
  const onLoggedIn = vi.fn();
  render(<LoginPage onLoggedIn={onLoggedIn} />);
  await userEvent.type(screen.getByLabelText(/email/i), "a@b.ch");
  await userEvent.type(screen.getByLabelText(/password/i), "pw123456");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(login).toHaveBeenCalledWith("a@b.ch", "pw123456");
  expect(onLoggedIn).toHaveBeenCalledWith(user);
});

it("shows an error on rejected login", async () => {
  vi.spyOn(client, "login").mockRejectedValue(new Error("401"));
  render(<LoginPage onLoggedIn={() => {}} />);
  await userEvent.type(screen.getByLabelText(/email/i), "a@b.ch");
  await userEvent.type(screen.getByLabelText(/password/i), "wrong123");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
});
```

Create `frontend/src/auth/AuthContext.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { AuthProvider, useAuth } from "./AuthContext";

afterEach(() => vi.restoreAllMocks());

const admin = { id: 1, email: "a@b.ch", display_name: "Anna", role: "admin", is_active: true } as const;

function Probe() {
  const { user } = useAuth();
  return <div>hello {user.display_name}</div>;
}

it("renders children once the probe succeeds", async () => {
  vi.spyOn(client, "getMe").mockResolvedValue(admin as never);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  expect(await screen.findByText("hello Anna")).toBeInTheDocument();
});

it("renders the login page when the probe 401s", async () => {
  vi.spyOn(client, "getMe").mockRejectedValue(new Error("401"));
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
  expect(screen.queryByText(/hello/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/api/client.auth.test.ts src/components/LoginPage.test.tsx src/auth/AuthContext.test.tsx`
Expected: FAIL — exports/components don't exist.

- [ ] **Step 3: Implement**

`frontend/src/types.ts` — append:

```ts
export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role: "admin" | "member";
  is_active: boolean;
}
```

`frontend/src/api/client.ts` — add `AuthUser` to the type import; change `request` and add the handler + fns:

```ts
let onUnauthorized: (() => void) | null = null;

/** Called on any 401 except login/getMe probes — lets the app flip back to the login screen. */
export function setUnauthorizedHandler(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

async function request<T>(url: string, init?: RequestInit, notify401 = true): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    if (resp.status === 401 && notify401) onUnauthorized?.();
    const detail = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText}: ${detail}`);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}
```

```ts
export function login(email: string, password: string): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/login", json({ email, password }), false);
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function getMe(): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/me", undefined, false);
}

export function changeMyPassword(current_password: string, new_password: string): Promise<void> {
  return request<void>("/api/auth/me/password", {
    ...json({ current_password, new_password }),
    method: "PATCH",
  });
}

export function listUsers(): Promise<AuthUser[]> {
  return request<AuthUser[]>("/api/users");
}

export function createUser(payload: {
  email: string;
  display_name: string;
  password: string;
  role: "admin" | "member";
}): Promise<AuthUser> {
  return request<AuthUser>("/api/users", json(payload));
}

export function updateUser(
  id: number,
  payload: Partial<{ display_name: string; role: "admin" | "member"; is_active: boolean; password: string }>,
): Promise<AuthUser> {
  return request<AuthUser>(`/api/users/${id}`, { ...json(payload), method: "PATCH" });
}
```

`frontend/src/components/LoginPage.tsx`:

```tsx
import { useState } from "react";
import { login } from "../api/client";
import type { AuthUser } from "../types";

export default function LoginPage({ onLoggedIn }: { onLoggedIn: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await login(email.trim(), password));
    } catch {
      setError("Invalid email or password");
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
        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Email
          </span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <label className="mb-5 block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Password
          </span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
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

`frontend/src/auth/AuthContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getMe, setUnauthorizedHandler } from "../api/client";
import LoginPage from "../components/LoginPage";
import type { AuthUser } from "../types";

interface AuthValue {
  user: AuthUser;
  setUser: (user: AuthUser | null) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Gates the whole app: probes the session once, shows the login page when
 *  logged out, and flips back to it whenever any API call returns 401. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (!checked) return <div className="min-h-screen bg-gray-50" />;
  if (!user) return <LoginPage onLoggedIn={setUser} />;
  return <AuthContext.Provider value={{ user, setUser }}>{children}</AuthContext.Provider>;
}
```

`frontend/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 4: Run tests + type-check**

Run: `cd frontend && npx vitest run src/api/client.auth.test.ts src/components/LoginPage.test.tsx src/auth/AuthContext.test.tsx && npx tsc --noEmit`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/auth/AuthContext.tsx frontend/src/components/LoginPage.tsx frontend/src/main.tsx frontend/src/api/client.auth.test.ts frontend/src/components/LoginPage.test.tsx frontend/src/auth/AuthContext.test.tsx
git commit -m "feat(frontend): auth client, AuthProvider gating, login page"
```

---

### Task 8: Header user menu + role-aware UI

**Files:**
- Create: `frontend/src/components/UserMenu.tsx`
- Modify: `frontend/src/App.tsx` (user menu in header; hide Admin tab + Import for members)
- Modify: `frontend/src/components/BoardView.tsx` (`canEditLanes` prop)
- Test: `frontend/src/components/UserMenu.test.tsx`, `frontend/src/App.auth.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 7), `logout`, `changeMyPassword` (Task 7).
- Produces: `UserMenu({ user, onLoggedOut })` (dumb component); `BoardView` prop `canEditLanes?: boolean` (default `true`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/UserMenu.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import UserMenu from "./UserMenu";

afterEach(() => vi.restoreAllMocks());

const admin = { id: 1, email: "a@b.ch", display_name: "Anna", role: "admin", is_active: true } as const;

it("shows the name and an admin badge, and logs out", async () => {
  const logout = vi.spyOn(client, "logout").mockResolvedValue(undefined as never);
  const onLoggedOut = vi.fn();
  render(<UserMenu user={admin} onLoggedOut={onLoggedOut} />);
  expect(screen.getByText("Anna")).toBeInTheDocument();
  expect(screen.getByText("admin")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /log out/i }));
  expect(logout).toHaveBeenCalled();
  expect(onLoggedOut).toHaveBeenCalled();
});

it("changes the password through the modal", async () => {
  const change = vi.spyOn(client, "changeMyPassword").mockResolvedValue(undefined as never);
  render(<UserMenu user={{ ...admin, role: "member" }} onLoggedOut={() => {}} />);
  expect(screen.queryByText("admin")).not.toBeInTheDocument(); // members get no badge
  await userEvent.click(screen.getByRole("button", { name: /change password/i }));
  await userEvent.type(screen.getByLabelText(/current password/i), "old12345");
  await userEvent.type(screen.getByLabelText(/new password/i), "new12345");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(change).toHaveBeenCalledWith("old12345", "new12345");
});
```

Create `frontend/src/App.auth.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "./api/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";

afterEach(() => vi.restoreAllMocks());

function mockAppData(role: "admin" | "member") {
  vi.spyOn(client, "getMe").mockResolvedValue(
    { id: 1, email: "u@x.ch", display_name: "U", role, is_active: true } as never,
  );
  vi.spyOn(client, "getBoards").mockResolvedValue([] as never);
  vi.spyOn(client, "listItems").mockResolvedValue([] as never);
  vi.spyOn(client, "listLinks").mockResolvedValue([] as never);
  vi.spyOn(client, "getPlanningIntervals").mockResolvedValue([] as never);
  vi.spyOn(client, "getTeamMembers").mockResolvedValue([] as never);
  vi.spyOn(client, "getTeams").mockResolvedValue([] as never);
}

it("admins see the Admin tab and Import", async () => {
  mockAppData("admin");
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
  expect(await screen.findByRole("button", { name: "Admin" })).toBeInTheDocument();
  expect(screen.getByText(/import csv/i)).toBeInTheDocument();
});

it("members see neither the Admin tab nor Import", async () => {
  mockAppData("member");
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
  expect(await screen.findByText("U")).toBeInTheDocument(); // user menu rendered
  expect(screen.queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();
  expect(screen.queryByText(/import csv/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/UserMenu.test.tsx src/App.auth.test.tsx`
Expected: FAIL — `UserMenu` missing; App has no user menu / role logic.

- [ ] **Step 3: Implement `frontend/src/components/UserMenu.tsx`**

```tsx
import { useState } from "react";
import { changeMyPassword, logout } from "../api/client";
import type { AuthUser } from "../types";

export default function UserMenu({
  user,
  onLoggedOut,
}: {
  user: AuthUser;
  onLoggedOut: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);

  const doLogout = async () => {
    await logout();
    onLoggedOut();
  };

  const savePassword = async () => {
    setError(null);
    try {
      await changeMyPassword(current, next);
      setChanging(false);
      setCurrent("");
      setNext("");
    } catch {
      setError("Password change failed — check your current password.");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
        {user.display_name}
        {user.role === "admin" && (
          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            admin
          </span>
        )}
      </span>
      <button
        onClick={() => setChanging(true)}
        className="rounded-lg px-2 py-1 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
      >
        Change password
      </button>
      <button
        onClick={() => void doLogout()}
        className="rounded-lg px-2 py-1 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
      >
        Log out
      </button>

      {changing && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
          onClick={() => setChanging(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Change password</h2>
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Current password
              </span>
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
                New password
              </span>
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setChanging(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => void savePassword()}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire `App.tsx` + `BoardView.tsx`**

`frontend/src/App.tsx`:

- Add imports: `import UserMenu from "./components/UserMenu";` and `import { useAuth } from "./auth/AuthContext";`
- At the top of the component body: `const { user, setUser } = useAuth();` and `const isAdmin = user.role === "admin";`
- Nav: replace `{navButton("admin", "Admin")}` with `{isAdmin && navButton("admin", "Admin")}`
- Header right side — replace the existing block:

```tsx
        {view === "board" && (
          <div className="flex items-center gap-3">
            <ImportButton onImported={handleChanged} />
            <NewItemBar onCreated={handleChanged} />
          </div>
        )}
```

with:

```tsx
        <div className="flex items-center gap-3">
          {view === "board" && (
            <>
              {isAdmin && <ImportButton onImported={handleChanged} />}
              <NewItemBar onCreated={handleChanged} />
            </>
          )}
          <UserMenu user={user} onLoggedOut={() => setUser(null)} />
        </div>
```

- Pass `canEditLanes={isAdmin}` to `<BoardView ...>`.

`frontend/src/components/BoardView.tsx` — add the prop (default `true` so existing tests are untouched) and hide the button:

```tsx
export default function BoardView({
  board,
  items,
  links,
  filters,
  onOpenCard,
  onOpenStories,
  onChanged,
  canEditLanes = true,
}: {
  ...
  canEditLanes?: boolean;
}) {
```

Wrap the Edit-lanes control (the `div` with the button at the top of the returned JSX):

```tsx
      {canEditLanes && (
        <div className="flex justify-end px-6 pt-3">
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
          >
            {editing ? "Done" : "Edit lanes"}
          </button>
        </div>
      )}
      {canEditLanes && editing && <LaneEditor board={board} onChanged={onChanged} />}
```

- [ ] **Step 5: Run tests + type-check + full suite**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: ALL pass (including the new UserMenu/App tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/UserMenu.tsx frontend/src/App.tsx frontend/src/components/BoardView.tsx frontend/src/components/UserMenu.test.tsx frontend/src/App.auth.test.tsx
git commit -m "feat(frontend): header user menu, role-aware admin/import/lane controls"
```

---

### Task 9: Admin Users section + rebuild + end-to-end smoke

**Files:**
- Create: `frontend/src/components/admin/UsersSection.tsx`
- Modify: `frontend/src/components/admin/AdminView.tsx`
- Test: `frontend/src/components/admin/UsersSection.test.tsx` (+ add `listUsers` mock to `AdminView.test.tsx` if it fails with unmocked fetch, mirroring the existing `getPlanningIntervals` mock line)

**Interfaces:**
- Consumes: `listUsers`, `createUser`, `updateUser` (Task 7), `AdminCard` + class tokens (existing).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/admin/UsersSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import UsersSection from "./UsersSection";

afterEach(() => vi.restoreAllMocks());

const anna = { id: 1, email: "a@b.ch", display_name: "Anna", role: "admin", is_active: true } as const;
const ben = { id: 2, email: "b@b.ch", display_name: "Ben", role: "member", is_active: true } as const;

it("lists, creates, edits role, and deactivates users", async () => {
  vi.spyOn(client, "listUsers").mockResolvedValue([anna, ben] as never);
  const create = vi.spyOn(client, "createUser").mockResolvedValue({ ...ben, id: 3 } as never);
  const update = vi.spyOn(client, "updateUser").mockResolvedValue({ ...ben, role: "admin" } as never);

  render(<UsersSection currentUserId={1} />);
  expect(await screen.findByText("Anna")).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/name/i), "Cleo");
  await userEvent.type(screen.getByPlaceholderText(/email/i), "c@b.ch");
  await userEvent.type(screen.getByPlaceholderText(/password/i), "pw123456");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(create).toHaveBeenCalledWith({
    email: "c@b.ch",
    display_name: "Cleo",
    password: "pw123456",
    role: "member",
  });

  await userEvent.selectOptions(screen.getByLabelText("role of Ben"), "admin");
  expect(update).toHaveBeenCalledWith(2, { role: "admin" });

  await userEvent.click(screen.getByRole("button", { name: /deactivate ben/i }));
  expect(update).toHaveBeenCalledWith(2, { is_active: false });
});

it("hides the deactivate control for the current user", async () => {
  vi.spyOn(client, "listUsers").mockResolvedValue([anna] as never);
  render(<UsersSection currentUserId={1} />);
  expect(await screen.findByText("Anna")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /deactivate anna/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/admin/UsersSection.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `frontend/src/components/admin/UsersSection.tsx`**

```tsx
import { useEffect, useState } from "react";
import { createUser, listUsers, updateUser } from "../../api/client";
import type { AuthUser } from "../../types";
import AdminCard, {
  adminAddButtonClass,
  adminEmptyClass,
  adminInputClass,
  adminRowClass,
} from "./AdminCard";

export default function UsersSection({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");

  const reload = () => void listUsers().then(setUsers);
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim() || !email.trim() || password.length < 8) return;
    await createUser({ email: email.trim(), display_name: name.trim(), password, role });
    setName("");
    setEmail("");
    setPassword("");
    setRole("member");
    reload();
  };

  const setUserRole = async (id: number, newRole: "admin" | "member") => {
    await updateUser(id, { role: newRole });
    reload();
  };

  const setActive = async (id: number, is_active: boolean) => {
    await updateUser(id, { is_active });
    reload();
  };

  const resetPassword = async (user: AuthUser) => {
    const pw = window.prompt(`New password for ${user.display_name} (min 8 chars)`);
    if (!pw || pw.length < 8) return;
    await updateUser(user.id, { password: pw });
  };

  return (
    <AdminCard title="Users" icon="👤" accent="bg-rose-50 text-rose-600" count={users.length}>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className={`${adminInputClass} min-w-[6rem] flex-1`}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className={`${adminInputClass} min-w-[8rem] flex-1`}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={`${adminInputClass} min-w-[7rem] flex-1`}
        />
        <select
          aria-label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "member")}
          className={adminInputClass}
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button onClick={() => void add()} className={adminAddButtonClass}>
          Add
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {users.map((u) => (
          <li key={u.id} className={adminRowClass}>
            <span className="flex min-w-0 items-center gap-2 truncate">
              <span className={`truncate font-medium ${u.is_active ? "text-gray-800" : "text-gray-400 line-through"}`}>
                {u.display_name}
              </span>
              <span className="truncate text-xs text-gray-400">{u.email}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <select
                aria-label={`role of ${u.display_name}`}
                value={u.role}
                onChange={(e) => void setUserRole(u.id, e.target.value as "admin" | "member")}
                className="rounded-lg border border-gray-200 px-1.5 py-0.5 text-xs text-gray-600"
                disabled={u.id === currentUserId}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
              <button
                aria-label={`reset password of ${u.display_name}`}
                onClick={() => void resetPassword(u)}
                className="rounded-md px-1.5 py-0.5 text-xs text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              >
                reset
              </button>
              {u.id !== currentUserId &&
                (u.is_active ? (
                  <button
                    aria-label={`deactivate ${u.display_name}`}
                    onClick={() => void setActive(u.id, false)}
                    className="rounded-md px-1.5 py-0.5 text-xs text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                  >
                    deactivate
                  </button>
                ) : (
                  <button
                    aria-label={`activate ${u.display_name}`}
                    onClick={() => void setActive(u.id, true)}
                    className="rounded-md px-1.5 py-0.5 text-xs text-gray-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                  >
                    activate
                  </button>
                ))}
            </span>
          </li>
        ))}
        {users.length === 0 && <li className={adminEmptyClass}>No users yet.</li>}
      </ul>
    </AdminCard>
  );
}
```

- [ ] **Step 4: Wire into `AdminView.tsx`**

`frontend/src/components/admin/AdminView.tsx` — import `UsersSection` and `useAuth`, render it in the grid:

```tsx
import { useAuth } from "../../auth/AuthContext";
import UsersSection from "./UsersSection";
```

Inside the component: `const { user } = useAuth();` and add `<UsersSection currentUserId={user.id} />` as the fourth child of the `grid` div.

`AdminView` now calls `useAuth`, so `AdminView.test.tsx` MUST be updated (it
will otherwise throw "useAuth must be used inside AuthProvider"): in both of
its tests, add `vi.spyOn(client, "getMe").mockResolvedValue({ id: 1, email:
"a@b.ch", display_name: "A", role: "admin", is_active: true } as never)` and
`vi.spyOn(client, "listUsers").mockResolvedValue([] as never)` beside the
existing `getPlanningIntervals` mock, and wrap the rendered element:
`render(<AuthProvider><AdminView ... /></AuthProvider>)` (import
`AuthProvider` from `../../auth/AuthContext`). Since the probe is async, turn
any immediate assertions after `render` into `await screen.findBy...` ones.

- [ ] **Step 5: Run the full frontend suite + type-check**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: ALL pass, clean.

- [ ] **Step 6: Rebuild the stack and smoke-test end to end**

```bash
docker compose up -d --build backend frontend
```

(The backend entrypoint runs `alembic upgrade head`; the image now includes bcrypt and the bootstrap runs because compose sets `BOOTSTRAP_ADMIN=true`.)

```bash
# anonymous is rejected
curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/api/items          # → 401
# admin can log in (cookie jar)
curl -s -c /tmp/kanban-cookies -X POST localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin"}'                    # → 200 JSON user
curl -s -b /tmp/kanban-cookies localhost:8000/api/auth/me                  # → 200 admin
curl -s -b /tmp/kanban-cookies -o /dev/null -w "%{http_code}\n" localhost:8000/api/items  # → 200
# member cannot import: create one, log in, try import
curl -s -b /tmp/kanban-cookies -X POST localhost:8000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"m@example.com","display_name":"M","password":"member123","role":"member"}' # → 201
curl -s -c /tmp/member-cookies -X POST localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"m@example.com","password":"member123"}'                     # → 200
curl -s -b /tmp/member-cookies -o /dev/null -w "%{http_code}\n" \
  -X POST localhost:8000/api/import -F "file=@backend/tests/fixtures/team_planning.csv"    # → 403
```

Browser check at `http://localhost:8080`: the login card appears; signing in as `admin@example.com`/`admin` shows the board with the user chip and Admin tab; Admin → Users lists the admin; logging out returns to the login card.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/admin/UsersSection.tsx frontend/src/components/admin/AdminView.tsx frontend/src/components/admin/UsersSection.test.tsx frontend/src/components/admin/AdminView.test.tsx
git commit -m "feat(frontend): admin Users section; end-to-end auth smoke"
```

---

## Self-Review Notes

- **Spec coverage:** models+migration+config (T1); hashing/sessions/deps incl. Bearer + sliding TTL (T2); login/logout/me/password with identical 401s and other-session revocation (T3); users CRUD, 409, reset-revokes, self-lockout, no DELETE (T4); global require_user + admin gates matching the spec matrix, `/api/health` open (T5); env-gated bootstrap + compose defaults (T6); AuthUser/client/401-handler/AuthProvider/LoginPage (T7); UserMenu + role-aware Admin tab/Import/Edit-lanes (T8); UsersSection + rebuild + curl/browser smoke (T9).
- **Type consistency:** `get_current_user` is the single override point (conftest, T4/T5 tests); `UserRead`/`AuthUser` field sets match; `createUser`/`updateUser` payloads match `UserCreate`/`UserUpdate`; `canEditLanes` default true keeps existing BoardView tests green.
- **Sequencing:** Task 3 introduces `anon_client` BEFORE Task 5 repurposes `client` as admin — auth-flow tests never depend on the override; Task 5 is the only task where pre-existing tests are touched (fixture only).
- **Known trade-offs (accepted in spec):** sliding-TTL commit on GET requests; no rate limiting; UsersSection follows the existing sections' no-try/catch pattern (server rejects self-demotion; reload restores UI).
