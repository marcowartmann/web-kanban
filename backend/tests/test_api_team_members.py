from app.models import Team


def test_create_member_without_team(client):
    resp = client.post("/api/v1/team-members", json={"name": "Solo"})
    assert resp.status_code == 201
    assert resp.json()["team_id"] is None
    assert resp.json()["team_name"] is None


def test_create_member_with_team_and_list_includes_team_name(client, db_session):
    team = Team(name="Network")
    db_session.add(team)
    db_session.commit()
    resp = client.post("/api/v1/team-members", json={"name": "Marco", "team_id": team.id})
    assert resp.status_code == 201
    body = client.get("/api/v1/team-members").json()
    assert body[0]["name"] == "Marco"
    assert body[0]["team_name"] == "Network"


def test_create_member_bad_team_returns_422(client):
    resp = client.post("/api/v1/team-members", json={"name": "X", "team_id": 999})
    assert resp.status_code == 422


def test_duplicate_member_returns_409(client):
    client.post("/api/v1/team-members", json={"name": "Marco"})
    assert client.post("/api/v1/team-members", json={"name": "Marco"}).status_code == 409


def test_delete_member(client):
    member_id = client.post("/api/v1/team-members", json={"name": "Marco"}).json()["id"]
    assert client.delete(f"/api/v1/team-members/{member_id}").status_code == 204
    assert client.get("/api/v1/team-members").json() == []
