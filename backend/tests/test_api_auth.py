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
    # anon_client's own cookie jar still holds the (still-valid) current-session cookie from
    # the login above, and request_token() prefers the cookie over the Authorization header —
    # so it must be dropped here to actually exercise the Bearer-token path for other_token.
    saved_cookie = anon_client.cookies.get("kanban_session")
    anon_client.cookies.delete("kanban_session")
    assert (
        anon_client.get("/api/auth/me", headers={"Authorization": f"Bearer {other_token}"}).status_code
        == 401
    )
    anon_client.cookies.set("kanban_session", saved_cookie)
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


def test_oversized_password_is_just_invalid(anon_client, db_session):
    _seed_user(db_session)
    resp = anon_client.post(
        "/api/auth/login", json={"email": "marco@x.ch", "password": "x" * 100}
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid credentials"}
