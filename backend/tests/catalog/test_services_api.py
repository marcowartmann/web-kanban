import pytest

from app.models import AuditEvent, User


@pytest.fixture()
def product_id(client):
    art_id = client.post("/api/v1/arts", json={"name": "ART"}).json()["id"]
    return client.post("/api/v1/products", json={"name": "Network", "art_id": art_id}).json()["id"]


def test_service_crud_any_user(member_client, client, product_id):
    r = member_client.post("/api/v1/services", json={"name": "Connectivity", "product_id": product_id})
    assert r.status_code == 201
    sid = r.json()["id"]
    assert r.json()["lifecycle_state"] == "planned"
    r = member_client.post("/api/v1/services", json={
        "name": "Campus", "product_id": product_id, "parent_service_id": sid,
        "lifecycle_state": "active",
    })
    assert r.status_code == 201
    tree = member_client.get(f"/api/v1/products/{product_id}/services").json()
    assert tree[0]["name"] == "Connectivity"
    assert tree[0]["children"][0]["name"] == "Campus"
    r = member_client.patch(f"/api/v1/services/{sid}", json={"lifecycle_state": "deprecated"})
    assert r.json()["lifecycle_state"] == "deprecated"


def test_service_delete_guard(member_client, product_id):
    parent = member_client.post("/api/v1/services",
                                json={"name": "P", "product_id": product_id}).json()["id"]
    member_client.post("/api/v1/services",
                       json={"name": "C", "product_id": product_id, "parent_service_id": parent})
    assert member_client.delete(f"/api/v1/services/{parent}").status_code == 409


def test_dependency_lifecycle(member_client, product_id):
    a = member_client.post("/api/v1/services",
                           json={"name": "A", "product_id": product_id}).json()["id"]
    b = member_client.post("/api/v1/services",
                           json={"name": "B", "product_id": product_id}).json()["id"]
    r = member_client.post(f"/api/v1/services/{a}/dependencies", json={
        "to_service_id": b, "dep_type": "requires", "criticality": "critical", "note": "core",
    })
    assert r.status_code == 201
    dep_id = r.json()["id"]
    deps = member_client.get(f"/api/v1/services/{a}/dependencies").json()
    assert deps["outbound"][0]["to_service_name"] == "B"
    assert deps["inbound"] == []
    deps_b = member_client.get(f"/api/v1/services/{b}/dependencies").json()
    assert deps_b["inbound"][0]["from_service_name"] == "A"
    # b now has an inbound dependency -> delete blocked
    assert member_client.delete(f"/api/v1/services/{b}").status_code == 409
    assert member_client.delete(
        f"/api/v1/services/{a}/dependencies/{dep_id}").status_code == 204
    assert member_client.delete(f"/api/v1/services/{b}").status_code == 204


def test_dependency_self_loop_422(member_client, product_id):
    a = member_client.post("/api/v1/services",
                           json={"name": "A", "product_id": product_id}).json()["id"]
    assert member_client.post(f"/api/v1/services/{a}/dependencies", json={
        "to_service_id": a, "dep_type": "uses", "criticality": "optional",
    }).status_code == 422


def test_service_options_flat(member_client, product_id):
    member_client.post("/api/v1/services", json={"name": "A", "product_id": product_id})
    opts = member_client.get("/api/v1/services").json()
    assert opts[0]["product_name"] == "Network"


def test_read_only_repo_returns_405(client, product_id, monkeypatch):
    from app.catalog.adapters.postgres import PostgresServiceRepository

    monkeypatch.setattr(PostgresServiceRepository, "read_only", True)
    assert client.post("/api/v1/services",
                       json={"name": "X", "product_id": product_id}).status_code == 405


def test_service_update_logs_field_level_audit(client, db_session, product_id):
    owner_id = client.post("/api/v1/users", json={"display_name": "Ada"}).json()["id"]
    parent_id = client.post(
        "/api/v1/services", json={"name": "Parent", "product_id": product_id}
    ).json()["id"]
    sid = client.post(
        "/api/v1/services",
        json={"name": "Connectivity", "product_id": product_id, "description": "old desc"},
    ).json()["id"]
    db_session.query(AuditEvent).filter_by(event_type="service.updated").delete()
    db_session.commit()

    r = client.patch(
        f"/api/v1/services/{sid}",
        json={
            "name": "Connectivity v2",
            "description": "old desc",
            "owner_user_id": owner_id,
            "parent_service_id": parent_id,
            "lifecycle_state": "active",
        },
    )
    assert r.status_code == 200

    events = db_session.query(AuditEvent).filter_by(event_type="service.updated").all()
    by_field = {e.field: e for e in events}

    assert by_field["name"].old_value == "Connectivity"
    assert by_field["name"].new_value == "Connectivity v2"
    # description was PATCHed but unchanged (same value) -> no event emitted
    assert "description" not in by_field
    assert by_field["owner"].old_value is None
    assert by_field["owner"].new_value == "Ada"
    assert by_field["parent"].old_value is None
    assert by_field["parent"].new_value == "Parent"
    assert by_field["lifecycle_state"].old_value == "planned"
    assert by_field["lifecycle_state"].new_value == "active"


def test_service_update_owner_reassignment_same_display_name_is_audited(
    client, db_session, product_id
):
    # Two distinct users sharing a display_name: reassigning owner between
    # them changes the FK (owner_user_id) but not the resolved name, so an
    # "owner" audit event must still fire — name-based comparison would miss it.
    ada1 = User(display_name="Ada", password_hash=None, role="member")
    ada2 = User(display_name="Ada", password_hash=None, role="member")
    db_session.add_all([ada1, ada2])
    db_session.commit()

    sid = client.post(
        "/api/v1/services",
        json={"name": "Connectivity", "product_id": product_id, "owner_user_id": ada1.id},
    ).json()["id"]
    db_session.query(AuditEvent).filter_by(event_type="service.updated").delete()
    db_session.commit()

    r = client.patch(f"/api/v1/services/{sid}", json={"owner_user_id": ada2.id})
    assert r.status_code == 200

    events = db_session.query(AuditEvent).filter_by(event_type="service.updated").all()
    by_field = {e.field: e for e in events}
    assert "owner" in by_field
    assert by_field["owner"].old_value == "Ada"
    assert by_field["owner"].new_value == "Ada"


def test_service_update_clearing_parent_is_audited(client, db_session, product_id):
    parent_id = client.post(
        "/api/v1/services", json={"name": "Parent", "product_id": product_id}
    ).json()["id"]
    sid = client.post(
        "/api/v1/services",
        json={"name": "Child", "product_id": product_id, "parent_service_id": parent_id},
    ).json()["id"]
    db_session.query(AuditEvent).filter_by(event_type="service.updated").delete()
    db_session.commit()

    r = client.patch(f"/api/v1/services/{sid}", json={"parent_service_id": None})
    assert r.status_code == 200

    events = db_session.query(AuditEvent).filter_by(event_type="service.updated").all()
    by_field = {e.field: e for e in events}
    assert "parent" in by_field
    assert by_field["parent"].old_value == "Parent"
    assert by_field["parent"].new_value is None
