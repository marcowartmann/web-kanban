from app.models import AuditEvent


def _events(db, event_type=None):
    q = db.query(AuditEvent)
    if event_type:
        q = q.filter(AuditEvent.event_type == event_type)
    return q.all()


def test_create_logs_item_created(client, db_session):
    resp = client.post("/api/items", json={"kind": "feature", "title": "F1"})
    assert resp.status_code == 201
    rows = _events(db_session, "item.created")
    assert len(rows) == 1
    assert rows[0].entity_type == "item"
    assert rows[0].entity_id == resp.json()["id"]
    assert rows[0].entity_label == "F1"
    assert rows[0].actor_name == "Test Admin"


def test_update_logs_one_row_per_changed_field_and_skips_position(client, db_session):
    item_id = client.post("/api/items", json={"kind": "feature", "title": "F1"}).json()["id"]
    resp = client.patch(
        f"/api/items/{item_id}",
        json={"status": "Ready", "story_points": 5, "position": 9},
    )
    assert resp.status_code == 200
    rows = _events(db_session, "item.updated")
    fields = {(r.field, r.old_value, r.new_value) for r in rows}
    assert ("status", None, "Ready") in fields or ("status", "", "Ready") in fields
    assert ("story_points", None, "5") in fields
    assert all(r.field != "position" for r in rows)


def test_unchanged_value_logs_nothing(client, db_session):
    item_id = client.post("/api/items", json={"kind": "feature", "title": "F1"}).json()["id"]
    db_session.query(AuditEvent).delete()
    db_session.commit()
    client.patch(f"/api/items/{item_id}", json={"title": "F1"})
    assert _events(db_session, "item.updated") == []


def test_delete_logs_item_and_cascaded_children(client, db_session):
    feature_id = client.post("/api/items", json={"kind": "feature", "title": "F"}).json()["id"]
    client.post("/api/items", json={"kind": "story", "title": "S", "parent_id": feature_id})
    assert client.delete(f"/api/items/{feature_id}").status_code == 204
    rows = _events(db_session, "item.deleted")
    assert {r.entity_label for r in rows} == {"F", "S"}


def test_item_events_endpoint_newest_first_and_scoped(client, db_session):
    a = client.post("/api/items", json={"kind": "feature", "title": "A"}).json()["id"]
    b = client.post("/api/items", json={"kind": "feature", "title": "B"}).json()["id"]
    client.patch(f"/api/items/{a}", json={"status": "Ready"})
    events = client.get(f"/api/items/{a}/events").json()
    assert [e["event_type"] for e in events] == ["item.updated", "item.created"]
    assert all(e["entity_id"] == a for e in events)
    assert client.get(f"/api/items/{b}/events").json()[0]["event_type"] == "item.created"
    assert client.get("/api/items/999/events").status_code == 404


def test_member_can_read_item_events(member_client, db_session):
    item_id = member_client.post("/api/items", json={"kind": "feature", "title": "M"}).json()["id"]
    events = member_client.get(f"/api/items/{item_id}/events").json()
    assert events[0]["event_type"] == "item.created"


def test_max_length_title_still_creates_and_audits(client, db_session):
    title = "t" * 512  # items.title max; entity_label is only 500
    resp = client.post("/api/items", json={"kind": "feature", "title": title})
    assert resp.status_code == 201
    row = db_session.query(AuditEvent).filter_by(event_type="item.created").one()
    assert row.entity_label == title[:500]
