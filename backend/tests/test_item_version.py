from app.models import AuditEvent


def _create(client, **fields):
    body = {"kind": "feature", "title": "V", **fields}
    resp = client.post("/api/v1/items", json=body)
    assert resp.status_code == 201
    return resp.json()


def test_version_starts_at_1_and_increments(client):
    item = _create(client)
    assert item["version"] == 1
    resp = client.patch(
        f"/api/v1/items/{item['id']}", json={"title": "V2", "version": 1}
    )
    assert resp.status_code == 200
    assert resp.json()["version"] == 2


def test_stale_version_conflicts_and_writes_nothing(client, db_session):
    item = _create(client)
    client.patch(f"/api/v1/items/{item['id']}", json={"title": "First", "version": 1})
    events_before = db_session.query(AuditEvent).count()
    resp = client.patch(
        f"/api/v1/items/{item['id']}", json={"title": "Second", "version": 1}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Item was modified by someone else — reload and retry"
    assert client.get(f"/api/v1/items/{item['id']}").json()["title"] == "First"
    assert db_session.query(AuditEvent).count() == events_before


def test_missing_version_is_422(client):
    item = _create(client)
    resp = client.patch(f"/api/v1/items/{item['id']}", json={"title": "X"})
    assert resp.status_code == 422


def test_version_is_never_audit_tracked(client, db_session):
    item = _create(client)
    client.patch(f"/api/v1/items/{item['id']}", json={"status": "New", "version": 1})
    fields = [e.field for e in db_session.query(AuditEvent).all() if e.event_type == "item.updated"]
    assert "version" not in fields
    assert "status" in fields
