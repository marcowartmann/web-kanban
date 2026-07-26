import pytest

from app.models import AuditEvent


@pytest.fixture()
def env(client, member_client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    pid = client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]
    cid = member_client.post("/api/v1/components",
                             json={"name": "C9300", "product_id": pid}).json()["id"]
    return {"pid": pid, "cid": cid}


def test_contract_crud_any_user(member_client, env):
    r = member_client.post("/api/v1/contracts", json={
        "name": "SmartNet", "product_id": env["pid"], "vendor_name": "Cisco",
        "end_date": "2026-08-15", "yearly_cost": 15000, "notice_period_days": 60,
    })
    assert r.status_code == 201
    body = r.json()
    assert body["vendor_name"] == "Cisco"
    assert body["status"] in ("expiring", "expired")
    ctid = body["id"]
    listed = member_client.get(f"/api/v1/products/{env['pid']}/contracts").json()
    assert listed[0]["name"] == "SmartNet"
    r = member_client.patch(f"/api/v1/contracts/{ctid}", json={"end_date": None})
    assert r.json()["status"] == "active"
    assert member_client.delete(f"/api/v1/contracts/{ctid}").status_code == 204


def test_link_flow_and_component_read(member_client, env):
    ctid = member_client.post("/api/v1/contracts", json={
        "name": "SmartNet", "product_id": env["pid"], "end_date": "2020-01-01",
    }).json()["id"]
    r = member_client.post(f"/api/v1/contracts/{ctid}/components",
                           json={"component_id": env["cid"]})
    assert r.status_code == 201
    assert [c["name"] for c in r.json()["components"]] == ["C9300"]
    comp = member_client.get(f"/api/v1/components/{env['cid']}").json()
    assert comp["contracts"][0]["name"] == "SmartNet"
    assert comp["contracts"][0]["status"] == "expired"
    # component delete blocked while covered
    assert member_client.delete(f"/api/v1/components/{env['cid']}").status_code == 409
    r = member_client.delete(f"/api/v1/contracts/{ctid}/components/{env['cid']}")
    assert r.status_code == 200
    assert r.json()["components"] == []


def test_flat_list_sorted(member_client, env):
    member_client.post("/api/v1/contracts",
                       json={"name": "Evergreen", "product_id": env["pid"]})
    member_client.post("/api/v1/contracts", json={
        "name": "Dead", "product_id": env["pid"], "end_date": "2020-01-01"})
    rows = member_client.get("/api/v1/contracts").json()
    assert rows[0]["name"] == "Dead"
    assert rows[0]["status"] == "expired"
    assert rows[-1]["name"] == "Evergreen"


def test_component_budget_fields_api(member_client, env):
    r = member_client.patch(f"/api/v1/components/{env['cid']}",
                            json={"yearly_run_cost": 1200.5, "replacement_budget": 90000})
    assert r.json()["yearly_run_cost"] == 1200.5
    r = member_client.post("/api/v1/components", json={
        "name": "New", "product_id": env["pid"], "yearly_run_cost": 10})
    assert r.status_code == 201
    assert r.json()["yearly_run_cost"] == 10


def test_contract_update_field_level_audit(client, env, db_session):
    ctid = client.post("/api/v1/contracts", json={
        "name": "S", "product_id": env["pid"], "vendor_name": "Cisco",
        "yearly_cost": 100}).json()["id"]
    db_session.query(AuditEvent).filter_by(event_type="contract.updated").delete()
    client.patch(f"/api/v1/contracts/{ctid}", json={
        "vendor_name": "Juniper", "yearly_cost": 200, "name": "S"})
    events = db_session.query(AuditEvent).filter_by(event_type="contract.updated").all()
    by_field = {e.field: e for e in events}
    assert by_field["vendor"].old_value == "Cisco"
    assert by_field["vendor"].new_value == "Juniper"
    assert float(by_field["yearly_cost"].new_value) == 200
    assert "name" not in by_field
