import pytest


@pytest.fixture()
def art_id(client):
    return client.post("/api/v1/arts", json={"name": "Platform ART"}).json()["id"]


def test_product_crud(client, art_id):
    r = client.post("/api/v1/products", json={"name": "Network", "art_id": art_id})
    assert r.status_code == 201
    pid = r.json()["id"]
    listed = client.get("/api/v1/products").json()
    assert listed[0]["art_name"] == "Platform ART"
    assert listed[0]["service_count"] == 0
    detail = client.get(f"/api/v1/products/{pid}").json()
    assert detail["name"] == "Network"
    r = client.patch(f"/api/v1/products/{pid}", json={"description": "core net"})
    assert r.json()["description"] == "core net"
    assert client.delete(f"/api/v1/products/{pid}").status_code == 204


def test_product_team_link(client, art_id):
    team_id = client.post("/api/v1/teams", json={"name": "Net Team"}).json()["id"]
    r = client.post("/api/v1/products",
                    json={"name": "Network", "art_id": art_id, "team_id": team_id})
    assert r.json()["team_name"] == "Net Team"
    r2 = client.post("/api/v1/products",
                     json={"name": "Other", "art_id": art_id, "team_id": team_id})
    assert r2.status_code == 422  # team already linked


def test_product_unknown_art_422(client):
    assert client.post("/api/v1/products",
                       json={"name": "P", "art_id": 999}).status_code == 422


def test_product_missing_404(client):
    assert client.get("/api/v1/products/999").status_code == 404


def test_product_writes_admin_only(member_client):
    assert member_client.post("/api/v1/products",
                              json={"name": "P", "art_id": 1}).status_code == 403
    assert member_client.get("/api/v1/products").status_code == 200
