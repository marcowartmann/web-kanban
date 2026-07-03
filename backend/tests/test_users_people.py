from app.models import Comment, Item, ItemKind, User


def _person(client, name, **extra):
    resp = client.post("/api/v1/users", json={"display_name": name, **extra})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_person_only_creation(client):
    body = _person(client, "No Login")
    assert body["email"] is None
    assert body["role"] == "member"
    listed = client.get("/api/v1/users").json()
    assert any(u["display_name"] == "No Login" and u["email"] is None for u in listed)


def test_password_requires_email(client):
    resp = client.post(
        "/api/v1/users", json={"display_name": "P", "password": "secret123"}
    )
    assert resp.status_code == 422
    assert "Password requires an email" in resp.text


def test_email_clear_rules(client):
    person = _person(client, "Clearable", email="clear@x.local")
    resp = client.patch(f"/api/v1/users/{person['id']}", json={"email": None})
    assert resp.status_code == 200
    assert resp.json()["email"] is None

    full = _person(client, "Locked", email="locked@x.local", password="secret123")
    resp = client.patch(f"/api/v1/users/{full['id']}", json={"email": None})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Remove the password first"


def test_delete_self_is_422(client):
    me = client.get("/api/v1/auth/me").json()
    resp = client.delete(f"/api/v1/users/{me['id']}")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Admins cannot delete themselves"


def test_delete_with_comments_409_no_force(client, db_session):
    person = _person(client, "Author P", email="author@x.local")
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "C"}).json()
    db_session.add(
        Comment(item_id=item["id"], author_id=person["id"], body="kept history")
    )
    db_session.commit()
    for qs in ("", "?force=true"):
        resp = client.delete(f"/api/v1/users/{person['id']}{qs}")
        assert resp.status_code == 409
        assert resp.json()["detail"] == "User 'Author P' has 1 comments — deactivate instead"


def test_delete_assigned_409_then_force_nulls(client, db_session):
    person = _person(client, "Assigned P")
    item = Item(kind=ItemKind.FEATURE, title="A", position=0, assignee_id=person["id"])
    db_session.add(item)
    db_session.commit()
    resp = client.delete(f"/api/v1/users/{person['id']}")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "User 'Assigned P' is assigned to 1 items"
    assert client.delete(f"/api/v1/users/{person['id']}?force=true").status_code == 204
    db_session.expire_all()
    assert db_session.get(Item, item.id).assignee_id is None
    assert db_session.get(User, person["id"]) is None


def test_delete_is_audited(client, db_session):
    from app.models import AuditEvent

    person = _person(client, "Bye P")
    assert client.delete(f"/api/v1/users/{person['id']}").status_code == 204
    row = db_session.query(AuditEvent).filter_by(event_type="user.deleted").one()
    assert row.entity_label == "Bye P"


def test_whitespace_email_is_treated_as_absent(client):
    resp = client.post(
        "/api/v1/users", json={"display_name": "W", "email": "   ", "password": "secret123"}
    )
    assert resp.status_code == 422
    assert "Password requires an email" in resp.text

    full = client.post(
        "/api/v1/users",
        json={"display_name": "WL", "email": "wl@x.local", "password": "secret123"},
    ).json()
    resp = client.patch(f"/api/v1/users/{full['id']}", json={"email": "   "})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Remove the password first"


def test_member_blocked_from_new_user_endpoints(client, member_client):
    person = client.post("/api/v1/users", json={"display_name": "Guarded"}).json()
    assert member_client.delete(f"/api/v1/users/{person['id']}").status_code == 403
    assert (
        member_client.patch(
            f"/api/v1/users/{person['id']}", json={"display_name": "Nope"}
        ).status_code
        == 403
    )


def test_options_is_member_accessible(client, member_client):
    _person(client, "Zeta")
    _person(client, "Alpha")
    resp = member_client.get("/api/v1/users/options")
    assert resp.status_code == 200
    names = [o["display_name"] for o in resp.json()]
    assert names == sorted(names)
    assert set(resp.json()[0]) == {"id", "display_name", "team_id"}
    assert member_client.get("/api/v1/users").status_code == 403
