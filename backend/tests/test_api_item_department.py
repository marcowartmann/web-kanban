from app.models import Team, TeamDepartment


def _team(db, name):
    t = Team(name=name)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _dep(db, name, team):
    d = TeamDepartment(name=name, team_id=team.id)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def _create(client, **over):
    body = {"kind": "feature", "title": "F", "leading_team": "Net"}
    body.update(over)
    return client.post("/api/v1/items", json=body)


def test_create_feature_with_matching_department(client, db_session):
    net = _team(db_session, "Net")
    dep = _dep(db_session, "FE", net)
    resp = _create(client, department_id=dep.id)
    assert resp.status_code == 201
    assert resp.json()["department_id"] == dep.id


def test_create_wrong_team_department_422(client, db_session):
    net = _team(db_session, "Net")
    cloud = _team(db_session, "Cloud")
    dep = _dep(db_session, "FE", cloud)
    resp = _create(client, department_id=dep.id)  # item leading_team = Net
    assert resp.status_code == 422


def test_create_department_on_risk_422(client, db_session):
    net = _team(db_session, "Net")
    dep = _dep(db_session, "FE", net)
    resp = _create(client, kind="risk", department_id=dep.id)
    assert resp.status_code == 422


def test_create_department_without_leading_team_422(client, db_session):
    net = _team(db_session, "Net")
    dep = _dep(db_session, "FE", net)
    resp = _create(client, leading_team=None, department_id=dep.id)
    assert resp.status_code == 422


def test_patch_sets_matching_department(client, db_session):
    net = _team(db_session, "Net")
    dep = _dep(db_session, "FE", net)
    created = _create(client).json()
    resp = client.patch(f"/api/v1/items/{created['id']}",
                        json={"version": created["version"], "department_id": dep.id})
    assert resp.status_code == 200
    assert resp.json()["department_id"] == dep.id


def test_patch_leading_team_change_clears_department(client, db_session):
    net = _team(db_session, "Net")
    cloud = _team(db_session, "Cloud")
    dep = _dep(db_session, "FE", net)
    created = _create(client, department_id=dep.id).json()
    resp = client.patch(f"/api/v1/items/{created['id']}",
                        json={"version": created["version"], "leading_team": "Cloud"})
    assert resp.status_code == 200
    assert resp.json()["department_id"] is None
