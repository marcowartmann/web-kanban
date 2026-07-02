import io


def test_anonymous_gets_401_everywhere(anon_client):
    assert anon_client.get("/api/v1/items").status_code == 401
    assert anon_client.get("/api/v1/boards").status_code == 401
    assert anon_client.get("/api/v1/teams").status_code == 401
    assert anon_client.get("/api/health").status_code == 200  # stays open


def test_member_can_work_with_items_and_read_masters(member_client):
    created = member_client.post("/api/v1/items", json={"kind": "feature", "title": "F"})
    assert created.status_code == 201
    assert member_client.get("/api/v1/teams").status_code == 200
    assert member_client.get("/api/v1/planning-intervals").status_code == 200
    assert member_client.get("/api/v1/capacities").status_code == 200
    assert member_client.get("/api/v1/boards").status_code == 200


def test_member_blocked_from_admin_mutations(member_client):
    assert member_client.post("/api/v1/teams", json={"name": "T"}).status_code == 403
    assert member_client.post("/api/v1/team-members", json={"name": "M"}).status_code == 403
    assert member_client.post("/api/v1/planning-intervals", json={"name": "PI9"}).status_code == 403
    assert (
        member_client.put(
            "/api/v1/capacities",
            json={"member_id": 1, "planning_interval": "PI", "iteration": 1, "points": 1},
        ).status_code
        == 403
    )
    csv = io.BytesIO(b"Title,Type\n")
    assert (
        member_client.post("/api/v1/import", files={"file": ("x.csv", csv, "text/csv")}).status_code
        == 403
    )


def test_member_blocked_from_lane_mutations(member_client):
    # The require_admin dependency runs BEFORE the handler, so even a
    # nonexistent board id yields 403 for members — no board setup needed.
    resp = member_client.post("/api/v1/boards/999/lanes", json={"name": "X"})
    assert resp.status_code == 403


def test_admin_can_mutate_masters(client):
    assert client.post("/api/v1/teams", json={"name": "T"}).status_code == 201
    assert client.post("/api/v1/planning-intervals", json={"name": "PI9"}).status_code == 201
