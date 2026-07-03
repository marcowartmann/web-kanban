from sqlalchemy import select

from app.models import AuditEvent, Container, Item, ItemKind, PlanningInterval, Team


def _seed_scope(db_session, *, team="Network", pi="PI1-Q3"):
    t = Team(name=team)
    p = PlanningInterval(name=pi, position=1)
    db_session.add_all([t, p])
    db_session.commit()
    return t, p


def _add_container(db_session, *, name, pi, team_id):
    c = Container(name=name, planning_interval=pi, team_id=team_id)
    db_session.add(c)
    db_session.commit()
    return c


def test_create_list_rename_delete_container(client, db_session):
    team, _ = _seed_scope(db_session)
    resp = client.post(
        "/api/v1/containers",
        json={"name": "Operations", "planning_interval": "PI1-Q3", "team_id": team.id},
    )
    assert resp.status_code == 201
    cid = resp.json()["id"]

    listed = client.get("/api/v1/containers").json()
    assert [(c["name"], c["planning_interval"], c["team_id"]) for c in listed] == [
        ("Operations", "PI1-Q3", team.id)
    ]

    assert (
        client.patch(f"/api/v1/containers/{cid}", json={"name": "Ops"}).json()["name"]
        == "Ops"
    )
    assert client.delete(f"/api/v1/containers/{cid}").status_code == 204
    assert client.get("/api/v1/containers").json() == []


def test_create_container_validates_scope(client, db_session):
    team, _ = _seed_scope(db_session)
    dup = {"name": "Operations", "planning_interval": "PI1-Q3", "team_id": team.id}
    assert client.post("/api/v1/containers", json=dup).status_code == 201
    assert client.post("/api/v1/containers", json=dup).status_code == 409
    assert (
        client.post(
            "/api/v1/containers",
            json={"name": "X", "planning_interval": "PI9", "team_id": team.id},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/containers",
            json={"name": "X", "planning_interval": "PI1-Q3", "team_id": 999},
        ).status_code
        == 422
    )


def test_rename_container_conflicts_within_scope(client, db_session):
    team, _ = _seed_scope(db_session)
    _add_container(db_session, name="Operations", pi="PI1-Q3", team_id=team.id)
    other = _add_container(db_session, name="Local Items", pi="PI1-Q3", team_id=team.id)
    assert (
        client.patch(f"/api/v1/containers/{other.id}", json={"name": "Operations"}).status_code
        == 409
    )


def test_delete_container_guard_and_force(client, db_session):
    team, _ = _seed_scope(db_session)
    c = _add_container(db_session, name="Operations", pi="PI1-Q3", team_id=team.id)
    item = Item(
        kind=ItemKind.STORY, title="S", planning_interval="PI1-Q3",
        leading_team="Network", container_id=c.id,
    )
    db_session.add(item)
    db_session.commit()

    resp = client.delete(f"/api/v1/containers/{c.id}")
    assert resp.status_code == 409
    assert "used by 1 items" in resp.json()["detail"]

    assert client.delete(f"/api/v1/containers/{c.id}?force=true").status_code == 204
    db_session.expire_all()
    assert db_session.get(Item, item.id).container_id is None


def test_container_writes_require_admin(member_client, db_session):
    team, _ = _seed_scope(db_session)
    c = _add_container(db_session, name="Operations", pi="PI1-Q3", team_id=team.id)
    assert member_client.get("/api/v1/containers").status_code == 200
    assert (
        member_client.post(
            "/api/v1/containers",
            json={"name": "X", "planning_interval": "PI1-Q3", "team_id": team.id},
        ).status_code
        == 403
    )
    assert member_client.patch(f"/api/v1/containers/{c.id}", json={"name": "Y"}).status_code == 403
    assert member_client.delete(f"/api/v1/containers/{c.id}").status_code == 403


def test_create_team_adds_default_containers(client, db_session):
    db_session.add(PlanningInterval(name="PI1-Q3", position=1))
    db_session.commit()
    client.post("/api/v1/teams", json={"name": "Network"})
    names = sorted(
        c["name"] for c in client.get("/api/v1/containers").json()
        if c["planning_interval"] == "PI1-Q3"
    )
    assert names == ["Local Items", "Operations", "Strategic Items"]
    audited = db_session.scalars(
        select(AuditEvent).where(AuditEvent.event_type == "container.created")
    ).all()
    assert len(audited) == 3
    assert all("(Network · PI1-Q3)" in e.entity_label for e in audited)


def test_create_planning_interval_adds_default_containers(client, db_session):
    db_session.add(Team(name="Network"))
    db_session.commit()
    client.post("/api/v1/planning-intervals", json={"name": "PI2-Q4"})
    names = sorted(c["name"] for c in client.get("/api/v1/containers").json())
    assert names == ["Local Items", "Operations", "Strategic Items"]


def test_pi_rename_propagates_to_containers(client, db_session):
    team, pi = _seed_scope(db_session)
    c = _add_container(db_session, name="Operations", pi="PI1-Q3", team_id=team.id)
    client.patch(f"/api/v1/planning-intervals/{pi.id}", json={"name": "PI1-Q3-NEW"})
    db_session.expire_all()
    assert db_session.get(Container, c.id).planning_interval == "PI1-Q3-NEW"


def test_pi_delete_removes_containers_and_clears_items(client, db_session):
    team, pi = _seed_scope(db_session)
    c = _add_container(db_session, name="Operations", pi="PI1-Q3", team_id=team.id)
    item = Item(kind=ItemKind.STORY, title="S", container_id=c.id)
    db_session.add(item)
    db_session.commit()
    # Containers alone must not trip the guard; the item has no PI so it
    # doesn't count either.
    assert client.delete(f"/api/v1/planning-intervals/{pi.id}").status_code == 204
    db_session.expire_all()
    assert db_session.get(Container, c.id) is None
    assert db_session.get(Item, item.id).container_id is None


def test_team_delete_removes_containers_and_clears_items(client, db_session):
    team, _ = _seed_scope(db_session)
    c = _add_container(db_session, name="Operations", pi="PI1-Q3", team_id=team.id)
    item = Item(kind=ItemKind.STORY, title="S", container_id=c.id)
    db_session.add(item)
    db_session.commit()
    assert client.delete(f"/api/v1/teams/{team.id}").status_code == 204
    db_session.expire_all()
    assert db_session.get(Container, c.id) is None
    assert db_session.get(Item, item.id).container_id is None


def _make_item(client, **extra):
    payload = {"kind": "story", "title": "S", **extra}
    resp = client.post("/api/v1/items", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_item_container_must_match_scope(client, db_session):
    team, _ = _seed_scope(db_session)
    c = _add_container(db_session, name="Operations", pi="PI1-Q3", team_id=team.id)

    resp = client.post(
        "/api/v1/items",
        json={"kind": "story", "title": "S", "planning_interval": "PI2",
              "leading_team": "Network", "container_id": c.id},
    )
    assert resp.status_code == 409

    item = _make_item(
        client, planning_interval="PI1-Q3", leading_team="Network", container_id=c.id
    )
    assert item["container_id"] == c.id

    # Unknown container id → 422
    resp = client.patch(
        f"/api/v1/items/{item['id']}",
        json={"version": item["version"], "container_id": 999},
    )
    assert resp.status_code == 422


def test_item_pi_change_auto_clears_container_and_audits(client, db_session):
    team, _ = _seed_scope(db_session)
    db_session.add(PlanningInterval(name="PI2-Q4", position=2))
    db_session.commit()
    c = _add_container(db_session, name="Operations", pi="PI1-Q3", team_id=team.id)
    item = _make_item(
        client, planning_interval="PI1-Q3", leading_team="Network", container_id=c.id
    )

    resp = client.patch(
        f"/api/v1/items/{item['id']}",
        json={"version": item["version"], "planning_interval": "PI2-Q4"},
    )
    assert resp.status_code == 200
    assert resp.json()["container_id"] is None

    cleared = db_session.scalars(
        select(AuditEvent).where(
            AuditEvent.event_type == "item.updated", AuditEvent.field == "container"
        )
    ).all()
    assert [(e.old_value, e.new_value) for e in cleared] == [("Operations", None)]


def test_item_container_assignment_audits_names(client, db_session):
    team, _ = _seed_scope(db_session)
    c = _add_container(db_session, name="Operations", pi="PI1-Q3", team_id=team.id)
    item = _make_item(client, planning_interval="PI1-Q3", leading_team="Network")

    resp = client.patch(
        f"/api/v1/items/{item['id']}",
        json={"version": item["version"], "container_id": c.id},
    )
    assert resp.status_code == 200
    event = db_session.scalars(
        select(AuditEvent).where(
            AuditEvent.event_type == "item.updated", AuditEvent.field == "container"
        )
    ).one()
    assert (event.old_value, event.new_value) == (None, "Operations")
