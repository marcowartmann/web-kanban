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
    assert [u["display_name"] for u in listed] == sorted(u["display_name"] for u in listed)

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


def test_deactivation_revokes_sessions(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")
    create_session(db_session, member)
    _as(admin)
    resp = anon_client.patch(f"/api/users/{member.id}", json={"is_active": False})
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


def test_multibyte_password_over_72_bytes_is_422(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    _as(admin)
    resp = anon_client.post(
        "/api/users",
        json={"email": "u@x.ch", "display_name": "U", "password": "ü" * 40, "role": "member"},
    )
    assert resp.status_code == 422
