from app.models import Item, ItemKind


def _make_feature(db, **kw):
    defaults = {"kind": ItemKind.FEATURE, "type": "Feature", "title": "F",
                "status": "Analyzing", "position": 0}
    defaults.update(kw)
    item = Item(**defaults)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_create_item(client):
    resp = client.post("/api/items", json={
        "kind": "feature", "title": "New Feature", "status": "Funnel",
        "business_value": 8, "time_criticality": 13, "risk_reduction": 13,
        "job_size": 1,
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "New Feature"
    assert body["cost_of_delay"] == 34
    assert body["wsjf_score"] == 34


def test_patch_status_only(client, db_session):
    feature = _make_feature(db_session)
    resp = client.patch(f"/api/items/{feature.id}", json={"status": "New"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "New"


def test_patch_recomputes_wsjf(client, db_session):
    feature = _make_feature(db_session, business_value=5, time_criticality=5,
                            risk_reduction=5, job_size=5, wsjf_score=0)
    resp = client.patch(f"/api/items/{feature.id}", json={"job_size": 3})
    assert resp.status_code == 200
    assert resp.json()["cost_of_delay"] == 15
    assert resp.json()["wsjf_score"] == 5


def test_get_missing_returns_404(client):
    assert client.get("/api/items/999").status_code == 404


def test_delete_feature_cascades(client, db_session):
    feature = _make_feature(db_session)
    db_session.add(Item(kind=ItemKind.STORY, type="Enabler Story",
                       title="child", position=0, parent_id=feature.id))
    db_session.commit()
    resp = client.delete(f"/api/items/{feature.id}")
    assert resp.status_code == 204
    assert db_session.query(Item).count() == 0


def test_list_filter_by_kind_and_search(client, db_session):
    _make_feature(db_session, title="Alpha Feature")
    db_session.add(Item(kind=ItemKind.RISK, type="Risk", title="Beta Risk",
                       status="New", position=0))
    db_session.commit()
    by_kind = client.get("/api/items?kind=risk").json()
    assert [i["title"] for i in by_kind] == ["Beta Risk"]
    by_q = client.get("/api/items?q=alpha").json()
    assert [i["title"] for i in by_q] == ["Alpha Feature"]


def test_list_filter_by_planning_interval(client, db_session):
    _make_feature(db_session, title="Q3 Feature", planning_interval="PI1-Q3")
    _make_feature(db_session, title="Q4 Feature", planning_interval="PI2-Q4")
    db_session.commit()
    out = client.get("/api/items?planning_interval=PI1-Q3").json()
    assert [i["title"] for i in out] == ["Q3 Feature"]


def test_patch_iteration_slot(client, db_session):
    story = _make_feature(db_session, kind=ItemKind.STORY, type="Story",
                          title="S", planning_interval="PI1-Q3")
    resp = client.patch(f"/api/items/{story.id}", json={"iteration": 6})
    assert resp.status_code == 200
    assert resp.json()["iteration"] == 6
    # Back to the backlog.
    cleared = client.patch(f"/api/items/{story.id}", json={"iteration": None})
    assert cleared.status_code == 200
    assert cleared.json()["iteration"] is None


def test_patch_iteration_out_of_range_rejected(client, db_session):
    story = _make_feature(db_session, kind=ItemKind.STORY, type="Story", title="S")
    assert client.patch(f"/api/items/{story.id}", json={"iteration": 0}).status_code == 422
    assert client.patch(f"/api/items/{story.id}", json={"iteration": 7}).status_code == 422
