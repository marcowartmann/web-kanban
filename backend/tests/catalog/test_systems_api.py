import pytest


@pytest.fixture()
def env(client, member_client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    pid = client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]
    cid = member_client.post("/api/v1/components", json={
        "name": "C9300", "product_id": pid, "end_of_life": "2020-01-01"}).json()["id"]
    return {"pid": pid, "cid": cid}


def test_system_crud_and_membership(member_client, env):
    r = member_client.post("/api/v1/systems", json={"name": "Fabric", "product_id": env["pid"]})
    assert r.status_code == 201
    sid = r.json()["id"]
    r = member_client.put(f"/api/v1/systems/{sid}/components",
                          json={"component_id": env["cid"], "quantity": 40})
    assert r.status_code == 200
    body = r.json()
    assert body["members"][0]["component"]["name"] == "C9300"
    assert body["members"][0]["quantity"] == 40
    assert body["risk"] == "danger"
    r = member_client.put(f"/api/v1/systems/{sid}/components",
                          json={"component_id": env["cid"], "quantity": 55})
    assert r.json()["members"][0]["quantity"] == 55
    listed = member_client.get(f"/api/v1/products/{env['pid']}/systems").json()
    assert listed[0]["name"] == "Fabric"
    r = member_client.delete(f"/api/v1/systems/{sid}/components/{env['cid']}")
    assert r.json()["members"] == []
    r = member_client.patch(f"/api/v1/systems/{sid}", json={"lifecycle_stage": "operate"})
    assert r.json()["lifecycle_stage"] == "operate"
    assert member_client.delete(f"/api/v1/systems/{sid}").status_code == 204


def test_membership_wrong_product_422(client, member_client, env):
    art_id = client.post("/api/v1/arts", json={"name": "A2"}).json()["id"]
    other = client.post("/api/v1/products", json={"name": "Other", "art_id": art_id}).json()["id"]
    foreign = member_client.post("/api/v1/components",
                                 json={"name": "F", "product_id": other}).json()["id"]
    sid = member_client.post("/api/v1/systems",
                             json={"name": "S", "product_id": env["pid"]}).json()["id"]
    assert member_client.put(f"/api/v1/systems/{sid}/components",
                             json={"component_id": foreign}).status_code == 422


def test_component_delete_blocked_while_member(member_client, env):
    sid = member_client.post("/api/v1/systems",
                             json={"name": "S", "product_id": env["pid"]}).json()["id"]
    member_client.put(f"/api/v1/systems/{sid}/components", json={"component_id": env["cid"]})
    assert member_client.delete(f"/api/v1/components/{env['cid']}").status_code == 409
