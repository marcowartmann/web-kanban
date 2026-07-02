def _board_id(client):
    return client.get("/api/v1/boards").json()[0]["id"]


def test_add_lane_appends_at_end(client):
    bid = _board_id(client)
    resp = client.post(f"/api/v1/boards/{bid}/lanes", json={"name": "Done"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Done"
    lanes = client.get("/api/v1/boards").json()[0]["lanes"]
    assert [lane["name"] for lane in lanes] == ["Funnel", "Analyzing", "New", "Done"]


def test_add_duplicate_lane_returns_409(client):
    bid = _board_id(client)
    assert client.post(f"/api/v1/boards/{bid}/lanes", json={"name": "Funnel"}).status_code == 409


def test_add_reserved_unscheduled_returns_409(client):
    bid = _board_id(client)
    assert client.post(f"/api/v1/boards/{bid}/lanes", json={"name": "Unscheduled"}).status_code == 409


def test_add_lane_missing_board_returns_404(client):
    assert client.post("/api/v1/boards/999/lanes", json={"name": "X"}).status_code == 404


def test_rename_lane(client):
    bid = _board_id(client)
    lane_id = client.get("/api/v1/boards").json()[0]["lanes"][0]["id"]
    resp = client.patch(f"/api/v1/lanes/{lane_id}", json={"name": "Backlog"})
    assert resp.status_code == 200 and resp.json()["name"] == "Backlog"


def test_rename_to_existing_name_returns_409(client):
    bid = _board_id(client)
    lane_id = client.get("/api/v1/boards").json()[0]["lanes"][0]["id"]
    assert client.patch(f"/api/v1/lanes/{lane_id}", json={"name": "Analyzing"}).status_code == 409


def test_delete_lane(client):
    bid = _board_id(client)
    lane_id = client.get("/api/v1/boards").json()[0]["lanes"][2]["id"]
    assert client.delete(f"/api/v1/lanes/{lane_id}").status_code == 204
    names = [lane["name"] for lane in client.get("/api/v1/boards").json()[0]["lanes"]]
    assert names == ["Funnel", "Analyzing"]


def test_delete_missing_lane_returns_404(client):
    assert client.delete("/api/v1/lanes/999").status_code == 404
