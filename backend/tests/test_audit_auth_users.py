from app.auth import get_current_user, hash_password
from app.main import app
from app.models import AuditEvent, Team, User


def _seed(db, email, role="member", password="secret123"):
    user = User(
        email=email,
        username=email.split("@")[0],
        display_name=email.split("@")[0],
        password_hash=hash_password(password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_login_success_and_failure_events(anon_client, db_session):
    user = _seed(db_session, "marco@x.ch")
    ok = anon_client.post("/api/v1/auth/login", json={"username": "marco", "password": "secret123", "method": "local"})
    assert ok.status_code == 200
    row = db_session.query(AuditEvent).filter_by(event_type="auth.login").one()
    assert row.actor_id == user.id and row.entity_label == "marco@x.ch"

    bad = anon_client.post("/api/v1/auth/login", json={"username": "ghost", "password": "nope-nope", "method": "local"})
    assert bad.status_code == 401
    assert bad.json() == {"detail": "Invalid credentials"}  # semantics unchanged
    failed = db_session.query(AuditEvent).filter_by(event_type="auth.login_failed").one()
    assert failed.actor_id is None and failed.actor_name is None
    assert failed.entity_label == "ghost"


def test_logout_event(anon_client, db_session):
    user = _seed(db_session, "marco@x.ch")
    anon_client.post("/api/v1/auth/login", json={"username": "marco", "password": "secret123", "method": "local"})
    assert anon_client.post("/api/v1/auth/logout").status_code == 204
    row = db_session.query(AuditEvent).filter_by(event_type="auth.logout").one()
    assert row.actor_id == user.id and row.entity_label == "marco@x.ch"


def test_password_change_event_redacted(anon_client, db_session):
    _seed(db_session, "marco@x.ch")
    anon_client.post("/api/v1/auth/login", json={"username": "marco", "password": "secret123", "method": "local"})
    resp = anon_client.patch(
        "/api/v1/auth/me/password",
        json={"current_password": "secret123", "new_password": "brandnew99"},
    )
    assert resp.status_code == 204
    row = db_session.query(AuditEvent).filter_by(event_type="user.password_changed").one()
    assert row.field == "password" and row.old_value == "***" and row.new_value == "***"
    assert "brandnew99" not in (row.new_value or "")


def test_user_created_and_updated_events(anon_client, db_session):
    admin = _seed(db_session, "admin@x.ch", role="admin")
    team = Team(name="Network")
    db_session.add(team)
    db_session.commit()
    app.dependency_overrides[get_current_user] = lambda: admin

    created = anon_client.post(
        "/api/v1/users",
        json={"email": "new@x.ch", "display_name": "New", "password": "longenough1", "role": "member"},
    )
    assert created.status_code == 201
    target_id = created.json()["id"]
    row = db_session.query(AuditEvent).filter_by(event_type="user.created").one()
    assert row.entity_id == target_id and row.entity_label == "new@x.ch"
    assert row.actor_id == admin.id

    resp = anon_client.patch(
        f"/api/v1/users/{target_id}",
        json={"role": "admin", "team_id": team.id, "password": "resetpass1"},
    )
    assert resp.status_code == 200
    updates = db_session.query(AuditEvent).filter_by(event_type="user.updated").all()
    by_field = {r.field: (r.old_value, r.new_value) for r in updates}
    assert by_field["role"] == ("member", "admin")
    assert by_field["team_id"] == (None, "Network")
    assert by_field["password"] == ("***", "***")
