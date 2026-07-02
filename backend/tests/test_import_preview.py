import hashlib
import io
import os
from pathlib import Path

from app.models import AuditEvent, Item
from tests.import_helpers import post_import

_FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def _csv(titles: list[str]) -> bytes:
    lines = ["Title,Type"] + [f"{t},Feature" for t in titles]
    return "\n".join(lines).encode()


def _preview(client, data: bytes):
    resp = client.post(
        "/api/v1/import/preview", files={"file": ("p.csv", io.BytesIO(data), "text/csv")}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_preview_returns_counts_and_guards(client):
    client.post("/api/v1/items", json={"kind": "feature", "title": "Old"})
    data = _FIXTURE.read_bytes()
    body = _preview(client, data)
    assert body["file_sha256"] == hashlib.sha256(data).hexdigest()
    assert len(body["state_stamp"]) == 16
    assert body["incoming"]["risks"] == 9
    assert body["incoming"]["features"] > 0
    assert body["incoming"]["stories"] > 0
    assert body["current"] == {"features": 1, "stories": 0, "risks": 0, "comments": 0, "links": 0}


def test_preview_writes_nothing(client, db_session):
    client.post("/api/v1/items", json={"kind": "feature", "title": "Keep"})
    items_before = db_session.query(Item).count()
    audit_before = db_session.query(AuditEvent).count()
    _preview(client, _FIXTURE.read_bytes())
    assert db_session.query(Item).count() == items_before
    assert db_session.query(AuditEvent).count() == audit_before
    snapshot_dir = Path(os.environ["SNAPSHOT_DIR"])
    assert not snapshot_dir.exists() or not any(snapshot_dir.iterdir())


def test_preview_title_diffs_and_caps(client):
    client.post("/api/v1/items", json={"kind": "feature", "title": "Removed-1"})
    client.post("/api/v1/items", json={"kind": "feature", "title": "Shared"})
    incoming = [f"Added-{i:02d}" for i in range(25)] + ["Shared"]
    body = _preview(client, _csv(incoming))
    assert body["added_titles"] == sorted([f"Added-{i:02d}" for i in range(25)])[:20]
    assert body["added_more"] == 5
    assert body["removed_titles"] == ["Removed-1"]
    assert body["removed_more"] == 0


def test_import_without_guard_fields_is_422(client):
    resp = client.post(
        "/api/v1/import",
        files={"file": ("p.csv", io.BytesIO(_csv(["A"])), "text/csv")},
    )
    assert resp.status_code == 422


def test_import_sha_mismatch_400(client):
    body = _preview(client, _csv(["A"]))
    resp = client.post(
        "/api/v1/import",
        files={"file": ("p.csv", io.BytesIO(_csv(["B"])), "text/csv")},
        data={"state_stamp": body["state_stamp"], "file_sha256": body["file_sha256"]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Uploaded file does not match the previewed file"


def test_import_stamp_mismatch_409(client, db_session):
    data = _csv(["A"])
    body = _preview(client, data)
    client.post("/api/v1/items", json={"kind": "feature", "title": "Sneaky edit"})
    resp = client.post(
        "/api/v1/import",
        files={"file": ("p.csv", io.BytesIO(data), "text/csv")},
        data={"state_stamp": body["state_stamp"], "file_sha256": body["file_sha256"]},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Data changed since preview — run the preview again"
    assert db_session.query(Item).filter_by(title="Sneaky edit").count() == 1


def test_import_snapshot_failure_500_aborts(client, db_session, monkeypatch, tmp_path):
    client.post("/api/v1/items", json={"kind": "feature", "title": "Survivor"})
    blocker = tmp_path / "snapshots-blocked"
    blocker.write_text("a file where the snapshot dir should be")
    monkeypatch.setenv("SNAPSHOT_DIR", str(blocker))  # mkdir -> FileExistsError (an OSError)
    data = _csv(["A"])
    body = _preview(client, data)
    audit_before = db_session.query(AuditEvent).count()
    resp = client.post(
        "/api/v1/import",
        files={"file": ("p.csv", io.BytesIO(data), "text/csv")},
        data={"state_stamp": body["state_stamp"], "file_sha256": body["file_sha256"]},
    )
    assert resp.status_code == 500
    assert resp.json()["detail"] == "Snapshot could not be written — import aborted"
    assert db_session.query(Item).filter_by(title="Survivor").count() == 1
    assert db_session.query(AuditEvent).count() == audit_before


def test_import_writes_snapshot_and_audit_names_it(client, db_session):
    client.post("/api/v1/items", json={"kind": "feature", "title": "Before"})
    resp = post_import(client, _csv(["After"]))
    assert resp.status_code == 200
    snapshot_dir = Path(os.environ["SNAPSHOT_DIR"])
    names = [p.name for p in snapshot_dir.iterdir()]
    assert len(names) == 1
    row = db_session.query(AuditEvent).filter_by(event_type="import.replaced").one()
    assert row.new_value == f"features=1 stories=0 risks=0 snapshot={names[0]}"
    import json as _json

    data = _json.loads((snapshot_dir / names[0]).read_text())
    assert data["counts"]["items"] == 1
    assert data["items"][0]["title"] == "Before"
