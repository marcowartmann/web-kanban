from app.auth import create_session, hash_password
from app.models import User, UserSession


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


def _local_login(client, username="marco", password="secret123"):
    return client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password, "method": "local"},
    )


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


def test_login_sets_cookie_and_me_roundtrip(anon_client, db_session):
    _seed_user(db_session)
    resp = _local_login(anon_client)
    assert resp.status_code == 200
    assert resp.json()["email"] == "marco@x.ch"
    assert "kanban_session" in resp.cookies
    me = anon_client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["display_name"] == "Marco"


def test_login_failures_are_identical_401(anon_client, db_session):
    _seed_user(db_session)
    _seed_user(db_session, email="off@x.ch", username="off", is_active=False)
    for payload in (
        {"username": "nobody", "password": "secret123", "method": "local"},
        {"username": "marco", "password": "wrong-password", "method": "local"},
        {"username": "off", "password": "secret123", "method": "local"},
    ):
        resp = anon_client.post("/api/v1/auth/login", json=payload)
        assert resp.status_code == 401
        assert resp.json() == {"detail": "Invalid credentials"}


class _FakeAuth:
    def __init__(self, identity):
        self._identity = identity

    def authenticate(self, uid, password):
        return self._identity if password == "good" else None


def _use_ldap(identity, monkeypatch):
    from app.config import settings
    from app.ldap_auth import get_authenticator
    from app.main import app

    monkeypatch.setattr(settings, "ldap_enabled", True)
    app.dependency_overrides[get_authenticator] = lambda: _FakeAuth(identity)


def _clear_ldap_override():
    from app.ldap_auth import get_authenticator
    from app.main import app

    app.dependency_overrides.pop(get_authenticator, None)


def test_ldap_login_provisions_and_authenticates(anon_client, db_session, monkeypatch):
    from app.ldap_auth import LdapIdentity

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
        _clear_ldap_override()


def test_ldap_login_bad_password_is_401(anon_client, db_session, monkeypatch):
    from app.ldap_auth import LdapIdentity

    _use_ldap(LdapIdentity(uid="jdoe", email=None, display_name="J"), monkeypatch)
    try:
        resp = anon_client.post(
            "/api/v1/auth/login",
            json={"username": "jdoe", "password": "bad", "method": "ldap"},
        )
        assert resp.status_code == 401
        assert resp.json() == {"detail": "Invalid credentials"}
    finally:
        _clear_ldap_override()


def test_ldap_method_disabled_is_401(anon_client, db_session):
    resp = anon_client.post(
        "/api/v1/auth/login",
        json={"username": "jdoe", "password": "good", "method": "ldap"},
    )
    assert resp.status_code == 401  # ldap_enabled is False by default


def test_auth_config_reports_ldap_flag(anon_client):
    assert anon_client.get("/api/v1/auth/config").json() == {"ldap_enabled": False}


def test_me_requires_auth(anon_client):
    assert anon_client.get("/api/v1/auth/me").status_code == 401


def test_bearer_header_works(anon_client, db_session):
    user = _seed_user(db_session)
    token = create_session(db_session, user)
    resp = anon_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_logout_revokes_and_is_idempotent(anon_client, db_session):
    _seed_user(db_session)
    _local_login(anon_client)
    assert anon_client.post("/api/v1/auth/logout").status_code == 204
    assert anon_client.get("/api/v1/auth/me").status_code == 401
    assert db_session.query(UserSession).count() == 0
    assert anon_client.post("/api/v1/auth/logout").status_code == 204  # no cookie: still 204


def test_password_change_revokes_other_sessions(anon_client, db_session):
    user = _seed_user(db_session)
    other_token = create_session(db_session, user)
    _local_login(anon_client)
    resp = anon_client.patch(
        "/api/v1/auth/me/password",
        json={"current_password": "secret123", "new_password": "brandnew99"},
    )
    assert resp.status_code == 204
    assert anon_client.get("/api/v1/auth/me").status_code == 200  # current session survives
    # anon_client's own cookie jar still holds the (still-valid) current-session cookie from
    # the login above, and request_token() prefers the cookie over the Authorization header —
    # so it must be dropped here to actually exercise the Bearer-token path for other_token.
    saved_cookie = anon_client.cookies.get("kanban_session")
    anon_client.cookies.delete("kanban_session")
    assert (
        anon_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {other_token}"}).status_code
        == 401
    )
    anon_client.cookies.set("kanban_session", saved_cookie)
    wrong = anon_client.patch(
        "/api/v1/auth/me/password",
        json={"current_password": "nope", "new_password": "whatever99"},
    )
    assert wrong.status_code == 401
    short = anon_client.patch(
        "/api/v1/auth/me/password",
        json={"current_password": "brandnew99", "new_password": "short"},
    )
    assert short.status_code == 422


def test_oversized_password_is_just_invalid(anon_client, db_session):
    _seed_user(db_session)
    resp = anon_client.post(
        "/api/v1/auth/login", json={"username": "marco", "password": "x" * 100, "method": "local"}
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid credentials"}


def test_me_includes_team(anon_client, db_session):
    from app.models import Team

    team = Team(name="Network")
    db_session.add(team)
    db_session.commit()
    user = _seed_user(db_session)
    user.team_id = team.id
    db_session.commit()

    _local_login(anon_client)
    body = anon_client.get("/api/v1/auth/me").json()
    assert body["team_id"] == team.id
    assert body["team_name"] == "Network"
