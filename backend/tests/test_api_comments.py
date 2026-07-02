from app.auth import get_current_user, hash_password
from app.main import app
from app.models import AuditEvent, Comment, User


def _seed_user(db, email, role="member", name=None):
    user = User(
        email=email,
        display_name=name or email.split("@")[0],
        password_hash=hash_password("secret123"),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def _item(client):
    return client.post("/api/items", json={"kind": "feature", "title": "F"}).json()["id"]


def test_post_and_list_threaded_order(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch", name="Anna")
    _as(author)
    item_id = _item(anon_client)
    first = anon_client.post(f"/api/items/{item_id}/comments", json={"body": "First!"})
    assert first.status_code == 201
    assert first.json()["author_name"] == "Anna"
    assert first.json()["updated_at"] is None
    reply = anon_client.post(
        f"/api/items/{item_id}/comments",
        json={"body": "A reply", "parent_id": first.json()["id"]},
    )
    assert reply.status_code == 201
    assert reply.json()["parent_id"] == first.json()["id"]
    second = anon_client.post(f"/api/items/{item_id}/comments", json={"body": "Second"})
    assert second.status_code == 201

    listed = anon_client.get(f"/api/items/{item_id}/comments").json()
    assert [c["body"] for c in listed] == ["First!", "A reply", "Second"]
    assert anon_client.get("/api/items/999/comments").status_code == 404


def test_reply_validations(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch")
    _as(author)
    item_a = _item(anon_client)
    item_b = _item(anon_client)
    parent = anon_client.post(f"/api/items/{item_a}/comments", json={"body": "p"}).json()
    reply = anon_client.post(
        f"/api/items/{item_a}/comments", json={"body": "r", "parent_id": parent["id"]}
    ).json()

    missing = anon_client.post(
        f"/api/items/{item_a}/comments", json={"body": "x", "parent_id": 999}
    )
    assert missing.status_code == 422
    cross = anon_client.post(
        f"/api/items/{item_b}/comments", json={"body": "x", "parent_id": parent["id"]}
    )
    assert cross.status_code == 422
    nested = anon_client.post(
        f"/api/items/{item_a}/comments", json={"body": "x", "parent_id": reply["id"]}
    )
    assert nested.status_code == 422
    assert nested.json()["detail"] == "replies cannot be nested"


def test_edit_permissions_and_marker(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch")
    other = _seed_user(db_session, "ben@x.ch")
    admin = _seed_user(db_session, "root@x.ch", role="admin")
    _as(author)
    item_id = _item(anon_client)
    comment = anon_client.post(f"/api/items/{item_id}/comments", json={"body": "v1"}).json()

    edited = anon_client.patch(f"/api/comments/{comment['id']}", json={"body": "v2"})
    assert edited.status_code == 200
    assert edited.json()["body"] == "v2"
    assert edited.json()["updated_at"] is not None

    _as(other)
    denied = anon_client.patch(f"/api/comments/{comment['id']}", json={"body": "hack"})
    assert denied.status_code == 403
    assert denied.json()["detail"] == "Not your comment"

    _as(admin)
    assert anon_client.patch(f"/api/comments/{comment['id']}", json={"body": "v3"}).status_code == 200
    assert anon_client.patch("/api/comments/999", json={"body": "x"}).status_code == 404


def test_delete_permissions_and_reply_cascade(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch")
    other = _seed_user(db_session, "ben@x.ch")
    admin = _seed_user(db_session, "root@x.ch", role="admin")
    _as(author)
    item_id = _item(anon_client)
    parent = anon_client.post(f"/api/items/{item_id}/comments", json={"body": "p"}).json()
    anon_client.post(f"/api/items/{item_id}/comments", json={"body": "r1", "parent_id": parent["id"]})
    anon_client.post(f"/api/items/{item_id}/comments", json={"body": "r2", "parent_id": parent["id"]})

    _as(other)
    assert anon_client.delete(f"/api/comments/{parent['id']}").status_code == 403

    _as(author)
    assert anon_client.delete(f"/api/comments/{parent['id']}").status_code == 204
    assert db_session.query(Comment).count() == 0  # replies cascaded

    other_comment = anon_client.post(f"/api/items/{item_id}/comments", json={"body": "mine"}).json()
    _as(admin)
    assert anon_client.delete(f"/api/comments/{other_comment['id']}").status_code == 204


def test_audit_events_with_excerpts(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch")
    _as(author)
    item_id = _item(anon_client)

    long_body = "x" * 150
    comment = anon_client.post(f"/api/items/{item_id}/comments", json={"body": long_body}).json()
    added = db_session.query(AuditEvent).filter_by(event_type="comment.added").one()
    assert added.entity_type == "item" and added.entity_id == item_id
    assert added.field == "comment"
    assert added.new_value == "x" * 120 + "…"

    anon_client.patch(f"/api/comments/{comment['id']}", json={"body": "short"})
    edited = db_session.query(AuditEvent).filter_by(event_type="comment.edited").one()
    assert edited.old_value == "x" * 120 + "…"
    assert edited.new_value == "short"

    anon_client.post(f"/api/items/{item_id}/comments", json={"body": "r", "parent_id": comment["id"]})
    anon_client.delete(f"/api/comments/{comment['id']}")
    deleted = db_session.query(AuditEvent).filter_by(event_type="comment.deleted").one()
    assert deleted.old_value == "short (+1 replies)"


def test_any_member_can_comment(member_client):
    item_id = member_client.post(
        "/api/items", json={"kind": "feature", "title": "M"}
    ).json()["id"]
    resp = member_client.post(f"/api/items/{item_id}/comments", json={"body": "hi"})
    assert resp.status_code == 201


def test_body_bounds(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch")
    _as(author)
    item_id = _item(anon_client)
    assert anon_client.post(f"/api/items/{item_id}/comments", json={"body": ""}).status_code == 422
    assert (
        anon_client.post(f"/api/items/{item_id}/comments", json={"body": "y" * 4001}).status_code
        == 422
    )
