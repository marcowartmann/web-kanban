import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.db import Base, get_db
from app.main import app
from app.models import User


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


@pytest.fixture()
def anon_client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _snapshot_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("SNAPSHOT_DIR", str(tmp_path / "snapshots"))
