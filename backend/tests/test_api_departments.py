from app.models import Team, TeamDepartment, User


def _team(db, name):
    t = Team(name=name)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _user(db, name):
    u = User(display_name=name, username=name.lower())
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_create_list_rename_delete(client, db_session):
    net = _team(db_session, "Net")
    created = client.post("/api/v1/departments", json={"name": "Frontend", "team_id": net.id})
    assert created.status_code == 201
    dep_id = created.json()["id"]
    assert created.json()["team_name"] == "Net"
    assert created.json()["member_ids"] == []

    listed = client.get("/api/v1/departments").json()
    assert [d["name"] for d in listed] == ["Frontend"]

    renamed = client.patch(f"/api/v1/departments/{dep_id}", json={"name": "FE"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "FE"

    assert client.delete(f"/api/v1/departments/{dep_id}").status_code == 204
    assert client.get("/api/v1/departments").json() == []


def test_duplicate_name_within_team_409(client, db_session):
    net = _team(db_session, "Net")
    client.post("/api/v1/departments", json={"name": "FE", "team_id": net.id})
    dup = client.post("/api/v1/departments", json={"name": "FE", "team_id": net.id})
    assert dup.status_code == 409


def test_same_name_different_team_ok(client, db_session):
    net = _team(db_session, "Net")
    cloud = _team(db_session, "Cloud")
    a = client.post("/api/v1/departments", json={"name": "FE", "team_id": net.id})
    b = client.post("/api/v1/departments", json={"name": "FE", "team_id": cloud.id})
    assert a.status_code == 201 and b.status_code == 201


def test_bad_team_422(client, db_session):
    resp = client.post("/api/v1/departments", json={"name": "FE", "team_id": 9999})
    assert resp.status_code == 422


def test_set_members_replaces(client, db_session):
    net = _team(db_session, "Net")
    dep = TeamDepartment(name="FE", team_id=net.id)
    db_session.add(dep)
    db_session.commit()
    db_session.refresh(dep)
    a = _user(db_session, "Ann")
    b = _user(db_session, "Ben")
    r1 = client.put(f"/api/v1/departments/{dep.id}/members", json={"user_ids": [a.id, b.id]})
    assert r1.status_code == 200 and r1.json()["member_ids"] == sorted([a.id, b.id])
    r2 = client.put(f"/api/v1/departments/{dep.id}/members", json={"user_ids": [a.id]})
    assert r2.json()["member_ids"] == [a.id]


def test_set_members_unknown_user_422(client, db_session):
    net = _team(db_session, "Net")
    dep = TeamDepartment(name="FE", team_id=net.id)
    db_session.add(dep)
    db_session.commit()
    db_session.refresh(dep)
    resp = client.put(f"/api/v1/departments/{dep.id}/members", json={"user_ids": [9999]})
    assert resp.status_code == 422


def test_members_cannot_manage_departments(member_client, db_session):
    net = _team(db_session, "Net")
    assert member_client.post("/api/v1/departments", json={"name": "FE", "team_id": net.id}).status_code == 403
    assert member_client.get("/api/v1/departments").status_code == 403
