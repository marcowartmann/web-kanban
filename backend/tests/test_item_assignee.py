from app.models import AuditEvent, Item, User


def _person(client, name):
    return client.post("/api/v1/users", json={"display_name": name}).json()


def test_create_with_assignee_id_serves_display_name(client):
    p = _person(client, "Worker")
    body = client.post(
        "/api/v1/items",
        json={"kind": "feature", "title": "F", "assignee_id": p["id"]},
    ).json()
    assert body["assignee_id"] == p["id"]
    assert body["assignee"] == "Worker"
    page = client.get("/api/v1/items").json()
    row = next(i for i in page["items"] if i["id"] == body["id"])
    assert row["assignee"] == "Worker" and row["assignee_id"] == p["id"]


def test_unknown_assignee_id_is_422(client):
    resp = client.post(
        "/api/v1/items", json={"kind": "feature", "title": "F", "assignee_id": 99999}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "assignee_id does not exist"
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "G"}).json()
    resp = client.patch(
        f"/api/v1/items/{item['id']}", json={"assignee_id": 99999, "version": 1}
    )
    assert resp.status_code == 422


def test_patch_set_and_clear_assignee(client):
    p = _person(client, "Setter")
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "S"}).json()
    setr = client.patch(
        f"/api/v1/items/{item['id']}", json={"assignee_id": p["id"], "version": 1}
    ).json()
    assert setr["assignee"] == "Setter"
    cleared = client.patch(
        f"/api/v1/items/{item['id']}", json={"assignee_id": None, "version": 2}
    ).json()
    assert cleared["assignee"] is None and cleared["assignee_id"] is None


def test_list_filter_by_assignee_id(client):
    p = _person(client, "Filter P")
    client.post("/api/v1/items", json={"kind": "feature", "title": "Mine", "assignee_id": p["id"]})
    client.post("/api/v1/items", json={"kind": "feature", "title": "Other"})
    page = client.get(f"/api/v1/items?assignee_id={p['id']}").json()
    assert [i["title"] for i in page["items"]] == ["Mine"]


def test_assignee_audit_logs_names(client, db_session):
    a = _person(client, "Alice")
    b = _person(client, "Bob")
    item = client.post(
        "/api/v1/items", json={"kind": "feature", "title": "T", "assignee_id": a["id"]}
    ).json()
    client.patch(f"/api/v1/items/{item['id']}", json={"assignee_id": b["id"], "version": 1})
    client.patch(f"/api/v1/items/{item['id']}", json={"assignee_id": None, "version": 2})
    rows = [
        (e.old_value, e.new_value)
        for e in db_session.query(AuditEvent)
        .filter_by(event_type="item.updated", field="assignee")
        .order_by(AuditEvent.id)
    ]
    assert rows == [("Alice", "Bob"), ("Bob", None)]


def test_assignee_race_is_caught_by_version_predicate(client, db_session):
    from sqlalchemy import update as core_update

    p = _person(client, "Racer")
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "R"}).json()
    # Hold a strong reference so the identity map keeps the stale instance
    # (weak-ref lesson from the P3 delete-race test).
    stale = db_session.get(Item, item["id"])
    assert stale.version == 1
    db_session.execute(
        core_update(Item).where(Item.id == item["id"]).values(version=99)
        .execution_options(synchronize_session=False)
    )
    resp = client.patch(
        f"/api/v1/items/{item['id']}", json={"assignee_id": p["id"], "version": 1}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Item was modified by someone else — reload and retry"


def test_old_string_assignee_patch_is_rejected(client):
    # ItemUpdate is extra="forbid"; the removed string field must 422 on PATCH.
    # (ItemCreate is not forbid — unknown keys there are ignored, existing behavior.)
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "F"}).json()
    resp = client.patch(
        f"/api/v1/items/{item['id']}", json={"assignee": "Ghost", "version": 1}
    )
    assert resp.status_code == 422
