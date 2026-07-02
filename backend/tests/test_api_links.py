from app.models import Item, ItemKind


def _item(db, kind=ItemKind.FEATURE, title="X"):
    it = Item(kind=kind, title=title)
    db.add(it)
    db.commit()
    db.refresh(it)
    return it


def test_link_relations_lists_directed_options(client):
    opts = client.get("/api/v1/link-relations").json()
    assert {"relation": "blocks", "direction": "incoming", "label": "blocked by"} in opts


def test_create_and_list_link(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, ItemKind.STORY, title="B")
    resp = client.post("/api/v1/links", json={"source_id": a.id, "target_id": b.id, "relation": "blocks"})
    assert resp.status_code == 201
    rows = client.get("/api/v1/links").json()
    assert len(rows) == 1
    assert rows[0]["source_id"] == a.id and rows[0]["target_id"] == b.id


def test_cross_kind_link_allowed(client, db_session):
    risk = _item(db_session, ItemKind.RISK, title="R")
    feat = _item(db_session, ItemKind.FEATURE, title="F")
    resp = client.post("/api/v1/links", json={"source_id": risk.id, "target_id": feat.id, "relation": "blocks"})
    assert resp.status_code == 201


def test_self_link_rejected(client, db_session):
    a = _item(db_session, title="A")
    resp = client.post("/api/v1/links", json={"source_id": a.id, "target_id": a.id, "relation": "blocks"})
    assert resp.status_code == 422


def test_unknown_relation_rejected(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    resp = client.post("/api/v1/links", json={"source_id": a.id, "target_id": b.id, "relation": "nope"})
    assert resp.status_code == 422


def test_missing_endpoint_rejected(client, db_session):
    a = _item(db_session, title="A")
    resp = client.post("/api/v1/links", json={"source_id": a.id, "target_id": 9999, "relation": "blocks"})
    assert resp.status_code == 422


def test_duplicate_rejected(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    body = {"source_id": a.id, "target_id": b.id, "relation": "blocks"}
    assert client.post("/api/v1/links", json=body).status_code == 201
    assert client.post("/api/v1/links", json=body).status_code == 409


def test_symmetric_relation_canonicalized_and_deduped(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    low, high = sorted([a.id, b.id])
    # created "backwards" -> stored canonical (low as source)
    first = client.post("/api/v1/links", json={"source_id": high, "target_id": low, "relation": "relates_to"})
    assert first.status_code == 201
    assert first.json()["source_id"] == low and first.json()["target_id"] == high
    # the forward direction is now a duplicate
    dup = client.post("/api/v1/links", json={"source_id": low, "target_id": high, "relation": "relates_to"})
    assert dup.status_code == 409


def test_delete_link(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    link_id = client.post("/api/v1/links", json={"source_id": a.id, "target_id": b.id, "relation": "blocks"}).json()["id"]
    assert client.delete(f"/api/v1/links/{link_id}").status_code == 204
    assert client.get("/api/v1/links").json() == []
    assert client.delete(f"/api/v1/links/{link_id}").status_code == 404


def test_detail_shows_link_from_both_ends(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, ItemKind.STORY, title="B")
    client.post("/api/v1/links", json={"source_id": a.id, "target_id": b.id, "relation": "blocks"})

    a_detail = client.get(f"/api/v1/items/{a.id}").json()
    assert len(a_detail["links"]) == 1
    assert a_detail["links"][0]["direction"] == "outgoing"
    assert a_detail["links"][0]["label"] == "blocks"
    assert a_detail["links"][0]["item"]["id"] == b.id

    b_detail = client.get(f"/api/v1/items/{b.id}").json()
    assert b_detail["links"][0]["direction"] == "incoming"
    assert b_detail["links"][0]["label"] == "blocked by"
    assert b_detail["links"][0]["item"]["id"] == a.id


def test_symmetric_link_labels_both_ends(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    client.post("/api/v1/links", json={"source_id": a.id, "target_id": b.id, "relation": "relates_to"})
    a_detail = client.get(f"/api/v1/items/{a.id}").json()
    b_detail = client.get(f"/api/v1/items/{b.id}").json()
    assert a_detail["links"][0]["label"] == "relates to"
    assert b_detail["links"][0]["label"] == "relates to"


def test_deleting_item_removes_its_links(client, db_session):
    a = _item(db_session, title="A")
    b = _item(db_session, title="B")
    client.post("/api/v1/links", json={"source_id": a.id, "target_id": b.id, "relation": "blocks"})
    assert client.delete(f"/api/v1/items/{a.id}").status_code == 204
    assert client.get("/api/v1/links").json() == []


def test_deleting_parent_removes_child_story_links(client, db_session):
    feature = _item(db_session, ItemKind.FEATURE, title="F")
    other = _item(db_session, ItemKind.FEATURE, title="Other")
    story = Item(kind=ItemKind.STORY, title="S", parent_id=feature.id)
    db_session.add(story)
    db_session.commit()
    db_session.refresh(story)
    client.post("/api/v1/links", json={"source_id": story.id, "target_id": other.id, "relation": "blocks"})
    assert client.delete(f"/api/v1/items/{feature.id}").status_code == 204
    assert client.get("/api/v1/links").json() == []
