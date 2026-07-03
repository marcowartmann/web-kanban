from app.models import Capacity


def _person(client, display_name="Marco"):
    return client.post("/api/v1/users", json={"display_name": display_name}).json()


def test_upsert_inserts_then_updates(client, db_session):
    p = _person(client)
    body = {"user_id": p["id"], "planning_interval": "PI1-Q3", "iteration": 1, "points": 8}
    first = client.put("/api/v1/capacities", json=body)
    assert first.status_code == 200
    assert first.json()["points"] == 8

    body["points"] = 5
    second = client.put("/api/v1/capacities", json=body)
    assert second.status_code == 200
    assert second.json()["points"] == 5
    # Same unique key -> still exactly one row.
    assert db_session.query(Capacity).count() == 1


def test_get_returns_saved_rows(client, db_session):
    p = _person(client)
    client.put("/api/v1/capacities", json={
        "user_id": p["id"], "planning_interval": "PI1-Q3", "iteration": 6, "points": 2})
    rows = client.get("/api/v1/capacities").json()
    assert len(rows) == 1
    assert rows[0]["iteration"] == 6 and rows[0]["points"] == 2


def test_validation_rejects_bad_values(client, db_session):
    p = _person(client)
    base = {"user_id": p["id"], "planning_interval": "PI1-Q3", "iteration": 1, "points": 1}
    assert client.put("/api/v1/capacities", json={**base, "iteration": 0}).status_code == 422
    assert client.put("/api/v1/capacities", json={**base, "iteration": 7}).status_code == 422
    assert client.put("/api/v1/capacities", json={**base, "points": -1}).status_code == 422
    assert client.put("/api/v1/capacities", json={**base, "user_id": 999}).status_code == 422


def test_deleting_user_cascades_capacities(client, db_session):
    p = _person(client)
    put_resp = client.put("/api/v1/capacities", json={
        "user_id": p["id"], "planning_interval": "PI1-Q3", "iteration": 1, "points": 8})
    assert put_resp.status_code == 200
    assert db_session.query(Capacity).count() == 1
    resp = client.delete(f"/api/v1/users/{p['id']}")
    assert resp.status_code == 204
    assert db_session.query(Capacity).count() == 0
