from app.models import AuditEvent


def _one(db, event_type):
    return db.query(AuditEvent).filter_by(event_type=event_type).one()


def test_team_and_pi_and_member_events(client, db_session):
    team_id = client.post("/api/v1/teams", json={"name": "Network"}).json()["id"]
    row = _one(db_session, "team.created")
    assert row.entity_id == team_id and row.entity_label == "Network"
    assert row.actor_name == "Test Admin"

    member_id = client.post("/api/v1/team-members", json={"name": "Marco"}).json()["id"]
    assert _one(db_session, "team_member.created").entity_label == "Marco"

    pi_id = client.post("/api/v1/planning-intervals", json={"name": "PI9"}).json()["id"]
    assert _one(db_session, "planning_interval.created").entity_label == "PI9"

    client.delete(f"/api/v1/planning-intervals/{pi_id}")
    assert _one(db_session, "planning_interval.deleted").entity_id == pi_id
    client.delete(f"/api/v1/team-members/{member_id}")
    assert _one(db_session, "team_member.deleted").entity_id == member_id
    client.delete(f"/api/v1/teams/{team_id}")
    assert _one(db_session, "team.deleted").entity_label == "Network"


def test_capacity_set_logs_old_and_new(client, db_session):
    member_id = client.post("/api/v1/team-members", json={"name": "Marco"}).json()["id"]
    client.put(
        "/api/v1/capacities",
        json={"member_id": member_id, "planning_interval": "PI1", "iteration": 2, "points": 3},
    )
    first = db_session.query(AuditEvent).filter_by(event_type="capacity.set").one()
    assert first.entity_label == "Marco · PI1 · I2"
    assert first.field == "points" and first.old_value is None and first.new_value == "3"

    client.put(
        "/api/v1/capacities",
        json={"member_id": member_id, "planning_interval": "PI1", "iteration": 2, "points": 5},
    )
    rows = db_session.query(AuditEvent).filter_by(event_type="capacity.set").all()
    assert ("3", "5") in {(r.old_value, r.new_value) for r in rows}


def test_lane_events(client, db_session):
    board_id = client.get("/api/v1/boards").json()[0]["id"]
    lane_id = client.post(f"/api/v1/boards/{board_id}/lanes", json={"name": "QA"}).json()["id"]
    assert _one(db_session, "lane.created").entity_label == "QA"

    client.patch(f"/api/v1/lanes/{lane_id}", json={"name": "QA2"})
    renamed = _one(db_session, "lane.renamed")
    assert renamed.field == "name" and renamed.old_value == "QA" and renamed.new_value == "QA2"

    order = [l["id"] for l in client.get("/api/v1/boards").json()[0]["lanes"]]
    client.put(f"/api/v1/boards/{board_id}/lanes/order", json={"lane_ids": order})
    assert _one(db_session, "lanes.reordered").entity_type == "board"

    client.delete(f"/api/v1/lanes/{lane_id}")
    assert _one(db_session, "lane.deleted").entity_label == "QA2"
