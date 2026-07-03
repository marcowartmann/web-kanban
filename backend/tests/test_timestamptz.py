from datetime import datetime

from app.models import Comment, User, UserSession
from app.timeutil import utcnow


def test_item_create_returns_aware_timestamps(client):
    body = client.post("/api/v1/items", json={"kind": "feature", "title": "TZ"}).json()
    detail = client.get(f"/api/v1/items/{body['id']}").json()
    # Pydantic v2 renders an exact-UTC datetime with a "Z" suffix rather than
    # "+00:00" — both are equivalent, valid ISO 8601/RFC 3339 for zero offset
    # and parse identically in JS `new Date()`. Parse-and-check-tzinfo is the
    # robust way to assert "this is offset-aware", independent of which
    # spelling the serializer picked.
    assert datetime.fromisoformat(detail["created_at"]).tzinfo is not None
    assert datetime.fromisoformat(detail["updated_at"]).tzinfo is not None


def test_item_update_refreshes_aware_updated_at(client):
    body = client.post("/api/v1/items", json={"kind": "feature", "title": "TZ2"}).json()
    updated = client.patch(
        f"/api/v1/items/{body['id']}", json={"title": "TZ2b", "version": 1}
    ).json()
    assert datetime.fromisoformat(updated["updated_at"]).tzinfo is not None


def test_comment_edit_sets_aware_updated_at(client, db_session):
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "C"}).json()
    comment = client.post(
        f"/api/v1/items/{item['id']}/comments", json={"body": "hi"}
    ).json()
    client.patch(f"/api/v1/comments/{comment['id']}", json={"body": "edited"})
    row = db_session.get(Comment, comment["id"])
    assert row.updated_at is not None and row.updated_at.tzinfo is not None
    assert row.created_at.tzinfo is not None


def test_session_expiry_is_aware(anon_client, db_session):
    from app.auth import hash_password

    user = User(
        email="tz@x.local",
        username="tz",
        display_name="TZ",
        password_hash=hash_password("secret123"),
        role="member",
    )
    db_session.add(user)
    db_session.commit()
    resp = anon_client.post(
        "/api/v1/auth/login", json={"username": "tz", "password": "secret123", "method": "local"}
    )
    assert resp.status_code == 200
    sess = db_session.query(UserSession).filter_by(user_id=user.id).one()
    assert sess.expires_at.tzinfo is not None
    assert sess.expires_at > utcnow()
    assert sess.created_at.tzinfo is not None
