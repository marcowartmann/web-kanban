from app.models import AuditEvent


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


def test_art_writes_admin_only(client, member_client):
    assert member_client.post("/api/v1/arts", json={"name": "A"}).status_code == 403
    assert member_client.get("/api/v1/arts").status_code == 200

    art_id = client.post("/api/v1/arts", json={"name": "B"}).json()["id"]
    assert member_client.patch(f"/api/v1/arts/{art_id}", json={"name": "x"}).status_code == 403
    assert member_client.delete(f"/api/v1/arts/{art_id}").status_code == 403


def test_art_update_logs_field_level_audit(client, db_session):
    art_id = client.post(
        "/api/v1/arts",
        json={"name": "Platform ART", "description": "old desc"},
    ).json()["id"]
    db_session.query(AuditEvent).filter_by(event_type="art.updated").delete()
    db_session.commit()

    r = client.patch(
        f"/api/v1/arts/{art_id}",
        json={"name": "Platform ART v2", "description": "old desc"},
    )
    assert r.status_code == 200

    events = db_session.query(AuditEvent).filter_by(event_type="art.updated").all()
    by_field = {e.field: e for e in events}

    assert by_field["name"].old_value == "Platform ART"
    assert by_field["name"].new_value == "Platform ART v2"
    # description was PATCHed but unchanged (same value) -> no event emitted
    assert "description" not in by_field
