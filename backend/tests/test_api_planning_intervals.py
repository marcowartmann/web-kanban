def test_create_list_ordered_and_dedupe(client):
    assert client.post("/api/planning-intervals", json={"name": "PI1-Q3"}).status_code == 201
    assert client.post("/api/planning-intervals", json={"name": "PI2-Q4"}).status_code == 201
    assert client.post("/api/planning-intervals", json={"name": "PI1-Q3"}).status_code == 409
    rows = client.get("/api/planning-intervals").json()
    assert [r["name"] for r in rows] == ["PI1-Q3", "PI2-Q4"]  # by position


def test_delete(client):
    pid = client.post("/api/planning-intervals", json={"name": "PIX"}).json()["id"]
    assert client.delete(f"/api/planning-intervals/{pid}").status_code == 204
    assert client.get("/api/planning-intervals").json() == []
    assert client.delete(f"/api/planning-intervals/{pid}").status_code == 404
