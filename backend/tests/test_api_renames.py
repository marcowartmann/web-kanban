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
