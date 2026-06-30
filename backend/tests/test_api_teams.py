from app.models import Team, TeamMember


def test_create_list_delete_team(client):
    resp = client.post("/api/teams", json={"name": "Network"})
    assert resp.status_code == 201
    team_id = resp.json()["id"]
    assert [t["name"] for t in client.get("/api/teams").json()] == ["Network"]
    assert client.delete(f"/api/teams/{team_id}").status_code == 204
    assert client.get("/api/teams").json() == []


def test_duplicate_team_returns_409(client):
    client.post("/api/teams", json={"name": "Network"})
    assert client.post("/api/teams", json={"name": "Network"}).status_code == 409


def test_delete_missing_team_returns_404(client):
    assert client.delete("/api/teams/999").status_code == 404


def test_delete_team_nulls_its_members(client, db_session):
    team = Team(name="Network")
    db_session.add(team)
    db_session.flush()
    member = TeamMember(name="Marco", team_id=team.id)
    db_session.add(member)
    db_session.commit()
    assert client.delete(f"/api/teams/{team.id}").status_code == 204
    db_session.expire_all()
    assert db_session.get(TeamMember, member.id).team_id is None
