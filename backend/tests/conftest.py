import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.db import Base, get_db
from app.main import app
from app.models import User

# `client` and `member_client` both override `get_current_user` on the same
# shared `app` object. A plain `lambda: user` override is a single dict entry
# keyed by `get_current_user`, so when a test requests both fixtures, whichever
# is set up second overwrites the first for EVERY request through either
# TestClient. Routing identity through a per-request header lets two
# concurrently-active role clients keep their own identity regardless of
# fixture setup order.
_FIXTURE_USER_HEADER = "X-Test-User-Id"


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, future=True)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _resolve_fixture_user(db_session):
    def _resolve(request: Request) -> User | None:
        raw = request.headers.get(_FIXTURE_USER_HEADER)
        return db_session.get(User, int(raw)) if raw is not None else None

    return _resolve


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
    app.dependency_overrides[get_current_user] = _resolve_fixture_user(db_session)
    return TestClient(app, headers={_FIXTURE_USER_HEADER: str(user.id)})


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


@pytest.fixture()
def anon_client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _snapshot_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("SNAPSHOT_DIR", str(tmp_path / "snapshots"))
