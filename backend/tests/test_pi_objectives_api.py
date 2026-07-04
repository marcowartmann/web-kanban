from app.models import Item, ItemKind, PlanningInterval, Team, User


def _seed(db):
    team = Team(name="Network")
    pi = PlanningInterval(name="PI1-Q3", position=1)
    db.add_all([team, pi])
    db.commit()
    return team, pi


def _member(db):
    return db.query(User).filter(User.role == "member").first()


def test_member_of_team_creates_objective(member_client, db_session):
    team, _pi = _seed(db_session)
    m = _member(db_session)
    m.team_id = team.id
    db_session.commit()
    r = member_client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "Ship X",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["state"] == "uncommitted"
    assert body["team_name"] == "Network"
    assert body["planning_interval"] == "PI1-Q3"
    assert body["feature_ids"] == []
    assert body["feature_count"] == 0


def test_non_team_member_forbidden(member_client, db_session):
    team, _pi = _seed(db_session)  # member has no team_id → not a member
    r = member_client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "X",
    })
    assert r.status_code == 403


def test_committed_key_delivery_ok_but_uncommitted_rejected(client, db_session):
    team, _pi = _seed(db_session)
    ok = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "KD",
        "state": "committed", "is_key_delivery": True,
    })
    assert ok.status_code == 201 and ok.json()["is_key_delivery"] is True
    bad = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "bad",
        "state": "uncommitted", "is_key_delivery": True,
    })
    assert bad.status_code == 422


def test_list_filters_by_pi_and_team(client, db_session):
    team, _pi = _seed(db_session)
    other = Team(name="Cloud")
    db_session.add(other)
    db_session.commit()
    for t in (team, other):
        client.post("/api/v1/pi-objectives", json={
            "team_id": t.id, "planning_interval": "PI1-Q3", "title": f"O-{t.name}",
        })
    r = client.get("/api/v1/pi-objectives", params={"planning_interval": "PI1-Q3", "team": "Network"})
    assert r.status_code == 200
    assert [o["team_name"] for o in r.json()] == ["Network"]


def test_patch_state_clears_key_delivery(client, db_session):
    team, _pi = _seed(db_session)
    oid = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "KD",
        "state": "committed", "is_key_delivery": True,
    }).json()["id"]
    r = client.patch(f"/api/v1/pi-objectives/{oid}", json={"state": "uncommitted"})
    assert r.status_code == 200
    assert r.json()["state"] == "uncommitted"
    assert r.json()["is_key_delivery"] is False


def test_put_features_enforces_team_and_pi(client, db_session):
    team, _pi = _seed(db_session)
    good = Item(kind=ItemKind.FEATURE, title="F", leading_team="Network", planning_interval="PI1-Q3")
    wrong_pi = Item(kind=ItemKind.FEATURE, title="F2", leading_team="Network", planning_interval="PI2-Q4")
    db_session.add_all([good, wrong_pi])
    db_session.commit()
    oid = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "O",
    }).json()["id"]
    ok = client.put(f"/api/v1/pi-objectives/{oid}/features", json={"feature_ids": [good.id]})
    assert ok.status_code == 200 and ok.json()["feature_ids"] == [good.id]
    assert ok.json()["feature_count"] == 1
    bad = client.put(f"/api/v1/pi-objectives/{oid}/features", json={"feature_ids": [wrong_pi.id]})
    assert bad.status_code == 422


def test_delete_objective(client, db_session):
    team, _pi = _seed(db_session)
    oid = client.post("/api/v1/pi-objectives", json={
        "team_id": team.id, "planning_interval": "PI1-Q3", "title": "O",
    }).json()["id"]
    assert client.delete(f"/api/v1/pi-objectives/{oid}").status_code == 204
    assert client.get("/api/v1/pi-objectives").json() == []
