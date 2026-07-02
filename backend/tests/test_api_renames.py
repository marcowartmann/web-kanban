from app.models import AuditEvent, Capacity, Item


def _mk_item(client, **fields):
    body = {"kind": "feature", "title": "T", **fields}
    resp = client.post("/api/items", json=body)
    assert resp.status_code == 201
    return resp.json()["id"]


def _events(db_session, event_type):
    return [
        e for e in db_session.query(AuditEvent).all() if e.event_type == event_type
    ]


def test_team_rename_propagates_to_items(client, db_session):
    team = client.post("/api/teams", json={"name": "Network"}).json()
    lead = _mk_item(client, leading_team="Network")
    support = _mk_item(client, supporting_team="Network")
    other = _mk_item(client, leading_team="Platform")

    resp = client.patch(f"/api/teams/{team['id']}", json={"name": "Net & Cloud"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Net & Cloud"
    assert client.get(f"/api/items/{lead}").json()["leading_team"] == "Net & Cloud"
    assert client.get(f"/api/items/{support}").json()["supporting_team"] == "Net & Cloud"
    assert client.get(f"/api/items/{other}").json()["leading_team"] == "Platform"

    events = _events(db_session, "team.renamed")
    assert len(events) == 1
    assert events[0].field == "name"
    assert events[0].old_value == "Network"
    assert events[0].new_value == "Net & Cloud"
    assert events[0].entity_label == "Net & Cloud"
    # propagation must not write per-item events
    assert _events(db_session, "item.updated") == []


def test_team_rename_conflicts_and_noop(client, db_session):
    a = client.post("/api/teams", json={"name": "A"}).json()
    client.post("/api/teams", json={"name": "B"})

    dup = client.patch(f"/api/teams/{a['id']}", json={"name": "B"})
    assert dup.status_code == 409
    assert dup.json()["detail"] == "Team already exists"

    noop = client.patch(f"/api/teams/{a['id']}", json={"name": "A"})
    assert noop.status_code == 200
    assert _events(db_session, "team.renamed") == []

    missing = client.patch("/api/teams/9999", json={"name": "X"})
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Team not found"


def test_team_delete_guard_and_force(client, db_session):
    team = client.post("/api/teams", json={"name": "Guarded"}).json()
    # one item referencing the team twice still counts once
    _mk_item(client, leading_team="Guarded", supporting_team="Guarded")
    _mk_item(client, supporting_team="Guarded")

    blocked = client.delete(f"/api/teams/{team['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "Team 'Guarded' is referenced by 2 items"

    forced = client.delete(f"/api/teams/{team['id']}?force=true")
    assert forced.status_code == 204
    assert len(_events(db_session, "team.deleted")) == 1


def test_team_delete_without_usage_needs_no_force(client):
    team = client.post("/api/teams", json={"name": "Idle"}).json()
    assert client.delete(f"/api/teams/{team['id']}").status_code == 204


def test_member_rename_propagates_assignee(client, db_session):
    m = client.post("/api/team-members", json={"name": "Anna"}).json()
    mine = _mk_item(client, assignee="Anna")
    other = _mk_item(client, assignee="Ben")

    resp = client.patch(f"/api/team-members/{m['id']}", json={"name": "Anna B."})
    assert resp.status_code == 200
    assert client.get(f"/api/items/{mine}").json()["assignee"] == "Anna B."
    assert client.get(f"/api/items/{other}").json()["assignee"] == "Ben"
    events = _events(db_session, "team_member.renamed")
    assert len(events) == 1 and events[0].old_value == "Anna"


def test_member_rename_conflict_and_delete_guard(client, db_session):
    a = client.post("/api/team-members", json={"name": "A"}).json()
    client.post("/api/team-members", json={"name": "B"})
    dup = client.patch(f"/api/team-members/{a['id']}", json={"name": "B"})
    assert dup.status_code == 409
    assert dup.json()["detail"] == "Member already exists"

    _mk_item(client, assignee="A")
    blocked = client.delete(f"/api/team-members/{a['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "Member 'A' is assigned to 1 items"
    assert client.delete(f"/api/team-members/{a['id']}?force=true").status_code == 204


def test_pi_rename_propagates_items_and_capacities(client, db_session):
    pi = client.post("/api/planning-intervals", json={"name": "PI1"}).json()
    member = client.post("/api/team-members", json={"name": "Cap"}).json()
    item = _mk_item(client, planning_interval="PI1")
    db_session.add(
        Capacity(member_id=member["id"], planning_interval="PI1", iteration=1, points=5)
    )
    db_session.commit()

    resp = client.patch(f"/api/planning-intervals/{pi['id']}", json={"name": "PI1-Q3"})
    assert resp.status_code == 200
    assert client.get(f"/api/items/{item}").json()["planning_interval"] == "PI1-Q3"
    caps = db_session.query(Capacity).all()
    assert [c.planning_interval for c in caps] == ["PI1-Q3"]
    assert len(_events(db_session, "planning_interval.renamed")) == 1


def test_pi_delete_guard_counts_items_and_capacities(client, db_session):
    pi = client.post("/api/planning-intervals", json={"name": "PI9"}).json()
    member = client.post("/api/team-members", json={"name": "Niner"}).json()
    _mk_item(client, planning_interval="PI9")
    db_session.add(
        Capacity(member_id=member["id"], planning_interval="PI9", iteration=2, points=3)
    )
    db_session.commit()

    blocked = client.delete(f"/api/planning-intervals/{pi['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == (
        "Planning interval 'PI9' is used by 1 items and 1 capacity entries"
    )
    assert client.delete(f"/api/planning-intervals/{pi['id']}?force=true").status_code == 204


def test_pi_rename_duplicate_409(client):
    a = client.post("/api/planning-intervals", json={"name": "P-A"}).json()
    client.post("/api/planning-intervals", json={"name": "P-B"})
    dup = client.patch(f"/api/planning-intervals/{a['id']}", json={"name": "P-B"})
    assert dup.status_code == 409
    assert dup.json()["detail"] == "Planning interval already exists"


def test_lane_rename_propagates_scoped_by_board_kinds(client, db_session):
    boards = client.get("/api/boards").json()
    risks_board = next(b for b in boards if b["kinds"] == ["risk"])
    new_lane = next(l for l in risks_board["lanes"] if l["name"] == "New")
    story_parent = _mk_item(client, kind="feature", status="New")
    risk = client.post(
        "/api/items", json={"kind": "risk", "title": "R", "status": "New"}
    ).json()["id"]

    resp = client.patch(f"/api/lanes/{new_lane['id']}", json={"name": "Fresh"})
    assert resp.status_code == 200
    assert client.get(f"/api/items/{risk}").json()["status"] == "Fresh"
    assert client.get(f"/api/items/{story_parent}").json()["status"] == "New"
    assert _events(db_session, "item.updated") == []
