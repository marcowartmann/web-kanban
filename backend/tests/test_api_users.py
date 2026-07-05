from app.auth import create_session, get_current_user, hash_password
from app.main import app
from app.models import User, UserSession


def _seed(db, email, role="member", **over):
    user = User(
        email=email,
        username=over.pop("username", email.split("@")[0]),
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
        "/api/v1/users",
        json={"email": "New@X.ch", "username": "newuser", "display_name": "New", "password": "longenough1", "role": "member"},
    )
    assert created.status_code == 201
    assert created.json()["email"] == "new@x.ch"  # lowercased
    dupe = anon_client.post(
        "/api/v1/users",
        json={"email": "new@x.ch", "username": "newuser2", "display_name": "N2", "password": "longenough1", "role": "member"},
    )
    assert dupe.status_code == 409
    listed = anon_client.get("/api/v1/users").json()
    assert [u["display_name"] for u in listed] == sorted(u["display_name"] for u in listed)

    target_id = created.json()["id"]
    patched = anon_client.patch(f"/api/v1/users/{target_id}", json={"role": "admin", "is_active": False})
    assert patched.status_code == 200
    assert patched.json()["role"] == "admin"
    assert patched.json()["is_active"] is False


def test_convert_local_to_ldap_clears_password_and_revokes_sessions(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch", username="jdoe")
    create_session(db_session, member)
    _as(admin)
    resp = anon_client.post(f"/api/v1/users/{member.id}/convert-provider", json={"provider": "ldap"})
    assert resp.status_code == 200
    assert resp.json()["auth_provider"] == "ldap"
    db_session.expire_all()
    fresh = db_session.get(User, member.id)
    assert fresh.password_hash is None
    assert db_session.query(UserSession).filter_by(user_id=member.id).count() == 0


def test_convert_to_local_requires_password_then_sets_it(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    ldap_user = _seed(db_session, "l@x.ch", username="lu", auth_provider="ldap")
    ldap_user.password_hash = None
    db_session.commit()
    _as(admin)
    missing = anon_client.post(f"/api/v1/users/{ldap_user.id}/convert-provider", json={"provider": "local"})
    assert missing.status_code == 422
    ok = anon_client.post(
        f"/api/v1/users/{ldap_user.id}/convert-provider",
        json={"provider": "local", "password": "newlocalpw1"},
    )
    assert ok.status_code == 200
    assert ok.json()["auth_provider"] == "local"
    db_session.expire_all()
    assert db_session.get(User, ldap_user.id).password_hash is not None


def test_convert_self_is_blocked(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin", username="adm")
    _as(admin)
    resp = anon_client.post(f"/api/v1/users/{admin.id}/convert-provider", json={"provider": "ldap"})
    assert resp.status_code == 422


def test_admin_password_reset_revokes_sessions(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")
    create_session(db_session, member)
    _as(admin)
    resp = anon_client.patch(f"/api/v1/users/{member.id}", json={"password": "resetpass1"})
    assert resp.status_code == 200
    assert db_session.query(UserSession).filter_by(user_id=member.id).count() == 0


def test_deactivation_revokes_sessions(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")
    create_session(db_session, member)
    _as(admin)
    resp = anon_client.patch(f"/api/v1/users/{member.id}", json={"is_active": False})
    assert resp.status_code == 200
    assert db_session.query(UserSession).filter_by(user_id=member.id).count() == 0


def test_self_lockout_guard(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    _as(admin)
    assert anon_client.patch(f"/api/v1/users/{admin.id}", json={"role": "member"}).status_code == 422
    assert anon_client.patch(f"/api/v1/users/{admin.id}", json={"is_active": False}).status_code == 422
    ok = anon_client.patch(f"/api/v1/users/{admin.id}", json={"display_name": "Boss"})
    assert ok.status_code == 200


def test_member_gets_403(anon_client, db_session):
    member = _seed(db_session, "m@x.ch")
    _as(member)
    assert anon_client.get("/api/v1/users").status_code == 403
    assert (
        anon_client.post(
            "/api/v1/users",
            json={"email": "x@x.ch", "display_name": "X", "password": "longenough1", "role": "member"},
        ).status_code
        == 403
    )


def test_unknown_user_404(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    _as(admin)
    assert anon_client.patch("/api/v1/users/999", json={"display_name": "X"}).status_code == 404


def test_multibyte_password_over_72_bytes_is_422(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    _as(admin)
    resp = anon_client.post(
        "/api/v1/users",
        json={"email": "u@x.ch", "display_name": "U", "password": "ü" * 40, "role": "member"},
    )
    assert resp.status_code == 422


def test_patch_email_change_dupe_and_self_exclusion(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    other = _seed(db_session, "other@x.ch")
    _as(admin)
    resp = anon_client.patch(f"/api/v1/users/{other.id}", json={"email": "New@Mail.CH"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "new@mail.ch"

    dupe = anon_client.patch(f"/api/v1/users/{other.id}", json={"email": "Admin@X.ch"})
    assert dupe.status_code == 409

    same = anon_client.patch(f"/api/v1/users/{other.id}", json={"email": "NEW@mail.ch"})
    assert same.status_code == 200  # own address in different case — self-exclusion


def test_patch_team_set_clear_invalid(anon_client, db_session):
    from app.models import Team

    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")
    team = Team(name="Network")
    db_session.add(team)
    db_session.commit()
    _as(admin)

    set_resp = anon_client.patch(f"/api/v1/users/{member.id}", json={"team_id": team.id})
    assert set_resp.status_code == 200
    assert set_resp.json()["team_id"] == team.id
    assert set_resp.json()["team_name"] == "Network"

    clear = anon_client.patch(f"/api/v1/users/{member.id}", json={"team_id": None})
    assert clear.status_code == 200
    assert clear.json()["team_id"] is None
    assert clear.json()["team_name"] is None

    bad = anon_client.patch(f"/api/v1/users/{member.id}", json={"team_id": 999})
    assert bad.status_code == 422


def test_create_with_team(anon_client, db_session):
    from app.models import Team

    admin = _seed(db_session, "admin@x.ch", role="admin")
    team = Team(name="Cloud")
    db_session.add(team)
    db_session.commit()
    _as(admin)

    created = anon_client.post(
        "/api/v1/users",
        json={
            "email": "u@x.ch",
            "username": "u1",
            "display_name": "U",
            "password": "longenough1",
            "role": "member",
            "team_id": team.id,
        },
    )
    assert created.status_code == 201
    assert created.json()["team_name"] == "Cloud"

    bad = anon_client.post(
        "/api/v1/users",
        json={
            "email": "v@x.ch",
            "username": "v1",
            "display_name": "V",
            "password": "longenough1",
            "role": "member",
            "team_id": 999,
        },
    )
    assert bad.status_code == 422


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
    resp = anon_client.patch(f"/api/v1/users/{member.id}", json={"email": None})
    assert resp.status_code == 200
    assert resp.json()["email"] is None


def test_user_read_includes_department_ids(anon_client, db_session):
    from app.models import Team, TeamDepartment
    admin = _seed(db_session, "admin@x.ch", role="admin")
    net = Team(name="Net")
    db_session.add(net)
    db_session.commit()
    dep = TeamDepartment(name="FE", team_id=net.id)
    db_session.add(dep)
    db_session.commit()
    admin.departments.append(dep)
    db_session.commit()
    _as(admin)
    body = anon_client.get("/api/v1/users").json()
    row = next(u for u in body if u["id"] == admin.id)
    assert row["department_ids"] == [dep.id]
    app.dependency_overrides.clear()


def test_set_user_departments_replaces(anon_client, db_session):
    from app.models import Team, TeamDepartment
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")
    net = Team(name="Net")
    db_session.add(net)
    db_session.commit()
    d1 = TeamDepartment(name="FE", team_id=net.id)
    d2 = TeamDepartment(name="BE", team_id=net.id)
    db_session.add_all([d1, d2])
    db_session.commit()
    _as(admin)
    r1 = anon_client.put(f"/api/v1/users/{member.id}/departments", json={"department_ids": [d1.id, d2.id]})
    assert r1.status_code == 200 and r1.json()["department_ids"] == sorted([d1.id, d2.id])
    r2 = anon_client.put(f"/api/v1/users/{member.id}/departments", json={"department_ids": [d2.id]})
    assert r2.json()["department_ids"] == [d2.id]
    app.dependency_overrides.clear()


def test_set_user_departments_unknown_422(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    member = _seed(db_session, "m@x.ch")
    _as(admin)
    resp = anon_client.put(f"/api/v1/users/{member.id}/departments", json={"department_ids": [9999]})
    assert resp.status_code == 422
    app.dependency_overrides.clear()


def test_user_read_includes_auth_provider(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    ldapu = _seed(db_session, "l@x.ch", username="ldapu")
    ldapu.auth_provider = "ldap"
    db_session.commit()
    _as(admin)
    body = anon_client.get("/api/v1/users").json()
    providers = {u["username"]: u["auth_provider"] for u in body}
    assert providers["admin"] == "local"
    assert providers["ldapu"] == "ldap"
    app.dependency_overrides.clear()
