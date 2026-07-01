from app.models import Capacity, TeamMember


def _member(db, name="Marco"):
    m = TeamMember(name=name)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def test_upsert_inserts_then_updates(client, db_session):
    m = _member(db_session)
    body = {"member_id": m.id, "planning_interval": "PI1-Q3", "iteration": 1, "points": 8}
    first = client.put("/api/capacities", json=body)
    assert first.status_code == 200
    assert first.json()["points"] == 8

    body["points"] = 5
    second = client.put("/api/capacities", json=body)
    assert second.status_code == 200
    assert second.json()["points"] == 5
    # Same unique key -> still exactly one row.
    assert db_session.query(Capacity).count() == 1


def test_get_returns_saved_rows(client, db_session):
    m = _member(db_session)
    client.put("/api/capacities", json={
        "member_id": m.id, "planning_interval": "PI1-Q3", "iteration": 6, "points": 2})
    rows = client.get("/api/capacities").json()
    assert len(rows) == 1
    assert rows[0]["iteration"] == 6 and rows[0]["points"] == 2


def test_validation_rejects_bad_values(client, db_session):
    m = _member(db_session)
    base = {"member_id": m.id, "planning_interval": "PI1-Q3", "iteration": 1, "points": 1}
    assert client.put("/api/capacities", json={**base, "iteration": 0}).status_code == 422
    assert client.put("/api/capacities", json={**base, "iteration": 7}).status_code == 422
    assert client.put("/api/capacities", json={**base, "points": -1}).status_code == 422
    assert client.put("/api/capacities", json={**base, "member_id": 999}).status_code == 422


def test_deleting_member_cascades_capacities(client, db_session):
    m = _member(db_session)
    client.put("/api/capacities", json={
        "member_id": m.id, "planning_interval": "PI1-Q3", "iteration": 1, "points": 8})
    client.delete(f"/api/team-members/{m.id}")
    assert db_session.query(Capacity).count() == 0
