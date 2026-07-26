import pytest


@pytest.fixture()
def env(client, member_client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    pid = client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]
    sid = member_client.post("/api/v1/services",
                             json={"name": "Connectivity", "product_id": pid}).json()["id"]
    cid = member_client.post("/api/v1/components", json={
        "name": "C9300", "product_id": pid, "end_of_life": "2020-01-01"}).json()["id"]
    sysid = member_client.post("/api/v1/systems",
                               json={"name": "Fabric", "product_id": pid}).json()["id"]
    return {"pid": pid, "sid": sid, "cid": cid, "sysid": sysid}


def test_tech_link_flow(member_client, env):
    r = member_client.post(f"/api/v1/services/{env['sid']}/tech/components",
                           json={"component_id": env["cid"]})
    assert r.status_code == 201
    assert r.json()["risk"] == "danger"
    r = member_client.post(f"/api/v1/services/{env['sid']}/tech/systems",
                           json={"system_id": env["sysid"]})
    assert r.status_code == 201
    tech = member_client.get(f"/api/v1/services/{env['sid']}/tech").json()
    assert [c["name"] for c in tech["components"]] == ["C9300"]
    assert [s["name"] for s in tech["systems"]] == ["Fabric"]
    r = member_client.delete(
        f"/api/v1/services/{env['sid']}/tech/components/{env['cid']}")
    assert r.status_code == 200
    assert r.json()["components"] == []
    assert r.json()["risk"] == "ok"  # Fabric has no members


def test_duplicate_link_422(member_client, env):
    member_client.post(f"/api/v1/services/{env['sid']}/tech/components",
                       json={"component_id": env["cid"]})
    assert member_client.post(f"/api/v1/services/{env['sid']}/tech/components",
                              json={"component_id": env["cid"]}).status_code == 422


def test_missing_link_404(member_client, env):
    assert member_client.delete(
        f"/api/v1/services/{env['sid']}/tech/systems/{env['sysid']}").status_code == 404
