def _fs_board(client):
    return client.get("/api/boards").json()[0]


def test_reorder_lanes_persists_new_order(client):
    board = _fs_board(client)
    ids = [lane["id"] for lane in board["lanes"]]  # [Funnel, Analyzing, New]
    new_order = [ids[2], ids[0], ids[1]]           # [New, Funnel, Analyzing]
    resp = client.put(f"/api/boards/{board['id']}/lanes/order", json={"lane_ids": new_order})
    assert resp.status_code == 200
    assert [lane["name"] for lane in resp.json()] == ["New", "Funnel", "Analyzing"]
    refetched = client.get("/api/boards").json()[0]["lanes"]
    assert [lane["name"] for lane in refetched] == ["New", "Funnel", "Analyzing"]


def test_reorder_with_wrong_ids_returns_422(client):
    board = _fs_board(client)
    ids = [lane["id"] for lane in board["lanes"]]
    assert client.put(
        f"/api/boards/{board['id']}/lanes/order", json={"lane_ids": ids[:2]}
    ).status_code == 422


def test_reorder_missing_board_returns_404(client):
    assert client.put("/api/boards/999/lanes/order", json={"lane_ids": []}).status_code == 404
