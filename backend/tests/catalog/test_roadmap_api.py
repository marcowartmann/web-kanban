import pytest

from app.models import AuditEvent


@pytest.fixture()
def env(client, member_client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    pid = client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]
    fid = member_client.post("/api/v1/items",
                             json={"kind": "feature", "title": "Wi-Fi 7 APs"}).json()["id"]
    return {"pid": pid, "fid": fid}


def test_stream_and_item_flow(member_client, env):
    sid = member_client.post("/api/v1/streams",
                             json={"name": "Campus", "product_id": env["pid"]}).json()["id"]
    r = member_client.post("/api/v1/roadmap-items", json={
        "title": "Wi-Fi 7 rollout", "stream_id": sid,
        "start_date": "2026-01-01", "end_date": "2026-06-30", "status": "committed",
    })
    assert r.status_code == 201
    iid = r.json()["id"]
    roadmap = member_client.get(f"/api/v1/products/{env['pid']}/roadmap").json()
    assert roadmap[0]["name"] == "Campus"
    assert roadmap[0]["items"][0]["title"] == "Wi-Fi 7 rollout"
    assert roadmap[0]["items"][0]["status"] == "committed"
    r = member_client.patch(f"/api/v1/roadmap-items/{iid}", json={"status": "done"})
    assert r.json()["status"] == "done"
    assert member_client.delete(f"/api/v1/roadmap-items/{iid}").status_code == 204
    assert member_client.delete(f"/api/v1/streams/{sid}").status_code == 204


def test_date_rule_422(member_client, env):
    sid = member_client.post("/api/v1/streams",
                             json={"name": "S", "product_id": env["pid"]}).json()["id"]
    assert member_client.post("/api/v1/roadmap-items", json={
        "title": "Bad", "stream_id": sid,
        "start_date": "2026-06-30", "end_date": "2026-01-01",
    }).status_code == 422


def test_feature_link_flow(member_client, env):
    sid = member_client.post("/api/v1/streams",
                             json={"name": "S", "product_id": env["pid"]}).json()["id"]
    iid = member_client.post("/api/v1/roadmap-items", json={
        "title": "X", "stream_id": sid,
        "start_date": "2026-01-01", "end_date": "2026-06-30"}).json()["id"]
    r = member_client.post(f"/api/v1/roadmap-items/{iid}/features",
                           json={"feature_id": env["fid"]})
    assert r.status_code == 201
    assert r.json()["features"][0]["title"] == "Wi-Fi 7 APs"
    assert member_client.post(f"/api/v1/roadmap-items/{iid}/features",
                              json={"feature_id": env["fid"]}).status_code == 422
    r = member_client.delete(f"/api/v1/roadmap-items/{iid}/features/{env['fid']}")
    assert r.status_code == 200
    assert r.json()["features"] == []


def test_stream_delete_guard_409(member_client, env):
    sid = member_client.post("/api/v1/streams",
                             json={"name": "S", "product_id": env["pid"]}).json()["id"]
    member_client.post("/api/v1/roadmap-items", json={
        "title": "X", "stream_id": sid,
        "start_date": "2026-01-01", "end_date": "2026-06-30"})
    assert member_client.delete(f"/api/v1/streams/{sid}").status_code == 409


def test_item_update_field_level_audit(client, env, db_session):
    s1 = client.post("/api/v1/streams",
                     json={"name": "S1", "product_id": env["pid"]}).json()["id"]
    s2 = client.post("/api/v1/streams",
                     json={"name": "S2", "product_id": env["pid"]}).json()["id"]
    iid = client.post("/api/v1/roadmap-items", json={
        "title": "X", "stream_id": s1,
        "start_date": "2026-01-01", "end_date": "2026-06-30"}).json()["id"]
    db_session.query(AuditEvent).filter_by(event_type="roadmap_item.updated").delete()
    client.patch(f"/api/v1/roadmap-items/{iid}", json={
        "status": "planned", "stream_id": s2, "title": "X"})
    events = db_session.query(AuditEvent).filter_by(event_type="roadmap_item.updated").all()
    by_field = {e.field: e for e in events}
    assert by_field["status"].new_value == "planned"
    assert by_field["stream"].old_value == "S1"
    assert by_field["stream"].new_value == "S2"
    assert "title" not in by_field
