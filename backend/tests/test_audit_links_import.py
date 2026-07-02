from pathlib import Path

from app.models import AuditEvent

_FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def test_link_add_and_remove_log_one_row_per_side(client, db_session):
    a = client.post("/api/items", json={"kind": "feature", "title": "A"}).json()["id"]
    b = client.post("/api/items", json={"kind": "feature", "title": "B"}).json()["id"]
    link = client.post(
        "/api/links", json={"source_id": a, "target_id": b, "relation": "blocks"}
    ).json()

    added = db_session.query(AuditEvent).filter_by(event_type="link.added").all()
    assert {r.entity_id for r in added} == {a, b}
    assert all(r.field == "link" for r in added)
    assert any(f"#{b} B" in (r.new_value or "") for r in added)
    assert any(f"#{a} A" in (r.new_value or "") for r in added)

    assert client.delete(f"/api/links/{link['id']}").status_code == 204
    removed = db_session.query(AuditEvent).filter_by(event_type="link.removed").all()
    assert {r.entity_id for r in removed} == {a, b}
    assert all(r.old_value and "blocks" in r.old_value for r in removed)


def test_import_logs_exactly_one_summary_event(client, db_session):
    with _FIXTURE.open("rb") as f:
        resp = client.post("/api/import", files={"file": ("p.csv", f, "text/csv")})
    assert resp.status_code == 200
    body = resp.json()
    rows = db_session.query(AuditEvent).filter_by(event_type="import.replaced").all()
    assert len(rows) == 1
    assert rows[0].entity_type == "import"
    assert rows[0].entity_label == "p.csv"
    assert rows[0].new_value == (
        f"features={body['features']} stories={body['stories']} risks={body['risks']}"
    )
    # No per-item events from the import path:
    assert db_session.query(AuditEvent).filter_by(event_type="item.created").count() == 0
    assert db_session.query(AuditEvent).filter_by(event_type="item.deleted").count() == 0
