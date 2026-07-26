import pytest

from app.models import AuditEvent


@pytest.fixture()
def product_id(client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    return client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]


def test_component_crud_any_user(member_client, product_id):
    r = member_client.post("/api/v1/components", json={
        "name": "Catalyst 9300", "product_id": product_id, "vendor_name": "Cisco",
        "model": "C9300-48P", "end_of_support": "2026-08-15",
    })
    assert r.status_code == 201
    body = r.json()
    cid = body["id"]
    assert body["vendor_name"] == "Cisco"
    assert body["lifecycle_stage"] == "plan"
    assert body["risk"] in ("warning", "danger")  # EoS within a year of any 2026 test date
    listed = member_client.get(f"/api/v1/products/{product_id}/components").json()
    assert listed[0]["name"] == "Catalyst 9300"
    r = member_client.patch(f"/api/v1/components/{cid}",
                            json={"lifecycle_stage": "operate", "quantity": 120})
    assert r.json()["lifecycle_stage"] == "operate"
    assert member_client.delete(f"/api/v1/components/{cid}").status_code == 204


def test_component_create_vendor_name_too_long_422(member_client, product_id):
    r = member_client.post("/api/v1/components", json={
        "name": "X", "product_id": product_id, "vendor_name": "x" * 129,
    })
    assert r.status_code == 422


def test_component_update_vendor_name_too_long_422(member_client, product_id):
    cid = member_client.post(
        "/api/v1/components", json={"name": "X", "product_id": product_id}
    ).json()["id"]
    r = member_client.patch(f"/api/v1/components/{cid}", json={"vendor_name": "x" * 129})
    assert r.status_code == 422


def test_component_duplicate_name_422(member_client, product_id):
    member_client.post("/api/v1/components", json={"name": "X", "product_id": product_id})
    assert member_client.post(
        "/api/v1/components", json={"name": "X", "product_id": product_id}
    ).status_code == 422


def test_vendors_listed(member_client, product_id):
    member_client.post("/api/v1/components",
                       json={"name": "X", "product_id": product_id, "vendor_name": "Cisco"})
    assert member_client.get("/api/v1/vendors").json()[0]["name"] == "Cisco"


def test_lifecycle_endpoint_sorted(member_client, product_id):
    member_client.post("/api/v1/components", json={"name": "NoDates", "product_id": product_id})
    member_client.post("/api/v1/components", json={
        "name": "Dead", "product_id": product_id, "end_of_life": "2020-01-01"})
    rows = member_client.get("/api/v1/lifecycle").json()
    assert rows[0]["name"] == "Dead"
    assert rows[0]["risk"] == "danger"
    assert rows[0]["product_name"] == "Network"
    assert rows[-1]["name"] == "NoDates"


def test_component_update_field_level_audit(client, product_id, db_session):
    cid = client.post("/api/v1/components", json={
        "name": "C", "product_id": product_id, "vendor_name": "Cisco"}).json()["id"]
    db_session.query(AuditEvent).filter_by(event_type="component.updated").delete()
    client.patch(f"/api/v1/components/{cid}", json={
        "vendor_name": "Juniper", "end_of_support": "2027-01-31", "name": "C",
        "yearly_run_cost": 1200.5,
    })
    events = db_session.query(AuditEvent).filter_by(event_type="component.updated").all()
    by_field = {e.field: e for e in events}
    assert by_field["vendor"].old_value == "Cisco"
    assert by_field["vendor"].new_value == "Juniper"
    assert by_field["end_of_support"].new_value == "2027-01-31"
    assert "name" not in by_field  # unchanged
    # numeric stringification may differ ("1200.5" vs "1200.50"); compare as float.
    assert by_field["yearly_run_cost"].old_value is None
    assert float(by_field["yearly_run_cost"].new_value) == 1200.5
