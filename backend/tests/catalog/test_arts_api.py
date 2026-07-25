def test_art_crud_as_admin(client):
    r = client.post("/api/v1/arts", json={"name": "Platform ART", "description": "d"})
    assert r.status_code == 201
    art_id = r.json()["id"]
    assert client.get("/api/v1/arts").json()[0]["name"] == "Platform ART"
    r = client.patch(f"/api/v1/arts/{art_id}", json={"name": "P-ART"})
    assert r.json()["name"] == "P-ART"
    assert client.delete(f"/api/v1/arts/{art_id}").status_code == 204
    assert client.get("/api/v1/arts").json() == []


def test_art_duplicate_name_422(client):
    client.post("/api/v1/arts", json={"name": "A"})
    assert client.post("/api/v1/arts", json={"name": "A"}).status_code == 422


def test_art_delete_with_products_409(client):
    art_id = client.post("/api/v1/arts", json={"name": "A"}).json()["id"]
    client.post("/api/v1/products", json={"name": "P", "art_id": art_id})
    assert client.delete(f"/api/v1/arts/{art_id}").status_code == 409


def test_art_writes_admin_only(member_client):
    assert member_client.post("/api/v1/arts", json={"name": "A"}).status_code == 403
    assert member_client.get("/api/v1/arts").status_code == 200
