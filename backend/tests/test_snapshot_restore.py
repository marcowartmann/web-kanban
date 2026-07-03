import json
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from app.models import AuditEvent, Comment, Item, ItemKind, ItemLink, User
from app.snapshots import write_snapshot
from tests.import_helpers import post_import


def _dump(db):
    """Raw persisted rows for the three snapshot tables, keyed by id."""
    out = {}
    for model in (Item, Comment, ItemLink):
        table = model.__table__
        rows = db.execute(select(table).order_by(table.c.id)).mappings()
        out[table.name] = {row["id"]: dict(row) for row in rows}
    return out


def _seed_rich(db):
    author = User(email="author@x.local", display_name="A", password_hash=None, role="member")
    db.add(author)
    db.flush()
    f1 = Item(kind=ItemKind.FEATURE, title="F1", position=0)
    db.add(f1)
    db.flush()
    s1 = Item(kind=ItemKind.STORY, title="S1", parent_id=f1.id, position=0)
    db.add(s1)
    db.flush()
    f2 = Item(kind=ItemKind.FEATURE, title="F2", position=1)
    db.add(f2)
    db.flush()
    s1.parent_id = f2.id  # re-parented: parent_id > id
    s1.updated_at = datetime(2020, 1, 2, 3, 4, 5)
    top = Comment(item_id=f1.id, author_id=author.id, body="top")
    db.add(top)
    db.flush()
    db.add(Comment(item_id=f1.id, parent_id=top.id, author_id=author.id, body="reply"))
    db.add(ItemLink(source_id=f1.id, target_id=f2.id, relation="blocks"))
    db.commit()
    return author


def _wipe(db):
    db.query(Comment).delete()
    db.query(ItemLink).delete()
    db.query(Item).delete()
    db.commit()


def test_snapshot_endpoints_require_admin(member_client):
    assert member_client.get("/api/v1/import/snapshots").status_code == 403
    assert (
        member_client.get(
            "/api/v1/import/snapshots/import-snapshot-20260101T000000-000000Z.json/download"
        ).status_code
        == 403
    )
    assert (
        member_client.post(
            "/api/v1/import/snapshots/import-snapshot-20260101T000000-000000Z.json/restore"
        ).status_code
        == 403
    )


def test_list_snapshots_endpoint_shape_and_order(client, db_session):
    _seed_rich(db_session)
    first = write_snapshot(db_session, actor="one@x.local")
    second = write_snapshot(db_session, actor="two@x.local")
    body = client.get("/api/v1/import/snapshots").json()
    names = [s["name"] for s in body["snapshots"]]
    assert names == sorted([first, second], reverse=True)
    assert body["snapshots"][0]["items"] == 3
    assert body["snapshots"][0]["comments"] == 2
    assert body["snapshots"][0]["links"] == 1


def test_download_returns_snapshot_json(client, db_session):
    _seed_rich(db_session)
    name = write_snapshot(db_session, actor="a@x.local")
    resp = client.get(f"/api/v1/import/snapshots/{name}/download")
    assert resp.status_code == 200
    assert resp.json()["counts"]["items"] == 3
    assert name in resp.headers.get("content-disposition", "")


def test_download_unknown_or_invalid_name_404(client):
    for bad in ("nope.json", "import-snapshot-20990101T000000-000000Z.json"):
        resp = client.get(f"/api/v1/import/snapshots/{bad}/download")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Snapshot not found"


def test_restore_unknown_name_404(client):
    resp = client.post(
        "/api/v1/import/snapshots/import-snapshot-20990101T000000-000000Z.json/restore"
    )
    assert resp.status_code == 404


def test_restore_round_trip_preserves_rows_and_ids(client, db_session):
    _seed_rich(db_session)
    before = _dump(db_session)
    name = write_snapshot(db_session, actor="a@x.local")
    _wipe(db_session)
    assert _dump(db_session) == {"items": {}, "comments": {}, "item_links": {}}

    resp = client.post(f"/api/v1/import/snapshots/{name}/restore")
    assert resp.status_code == 200
    body = resp.json()
    assert (body["items"], body["comments"], body["links"]) == (3, 2, 1)
    assert body["warnings"] == []
    db_session.expire_all()
    assert _dump(db_session) == before


def test_restore_skips_orphan_author_comments_with_warnings(client, db_session):
    author = _seed_rich(db_session)
    name = write_snapshot(db_session, actor="a@x.local")
    _wipe(db_session)
    db_session.delete(author)
    db_session.commit()

    body = client.post(f"/api/v1/import/snapshots/{name}/restore").json()
    assert body["comments"] == 0
    assert body["warnings"] == [
        "Skipped 1 comment(s) whose author no longer exists",
        "Skipped 1 comment(s) whose parent comment was skipped",
    ]
    db_session.expire_all()
    assert db_session.query(Comment).count() == 0
    assert db_session.query(Item).count() == 3


def test_restore_writes_pre_restore_snapshot_and_audit(client, db_session):
    _seed_rich(db_session)
    name = write_snapshot(db_session, actor="a@x.local")
    snapshot_dir = Path(os.environ["SNAPSHOT_DIR"])
    count_before = len(list(snapshot_dir.iterdir()))

    resp = client.post(f"/api/v1/import/snapshots/{name}/restore")
    assert resp.status_code == 200
    assert len(list(snapshot_dir.iterdir())) == count_before + 1

    row = db_session.query(AuditEvent).filter_by(event_type="import.restored").one()
    assert row.entity_type == "import"
    assert row.entity_label == name
    assert row.new_value == "items=3 comments=2 links=1"


def test_restore_unreadable_snapshot_400(client, db_session):
    import os
    from pathlib import Path

    name = "import-snapshot-20260101T000000-000000Z.json"
    d = Path(os.environ["SNAPSHOT_DIR"])
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text("{corrupt")
    resp = client.post(f"/api/v1/import/snapshots/{name}/restore")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Snapshot is unreadable"
    assert client.get("/api/v1/import/snapshots").json()["snapshots"] == []


def test_restore_clears_dangling_assignees_with_warning(client, db_session):
    person = client.post("/api/v1/users", json={"display_name": "Doomed"}).json()
    item = Item(kind=ItemKind.FEATURE, title="Owned", position=0, assignee_id=person["id"])
    db_session.add(item)
    db_session.commit()
    name = write_snapshot(db_session, actor="a@x.local")
    _wipe(db_session)
    assert client.delete(f"/api/v1/users/{person['id']}").status_code == 204

    body = client.post(f"/api/v1/import/snapshots/{name}/restore").json()
    assert "Cleared assignee for 1 item(s) whose user no longer exists" in body["warnings"]
    db_session.expire_all()
    assert db_session.query(Item).filter_by(title="Owned").one().assignee_id is None


def test_restore_legacy_snapshot_warns_and_unassigns(client, db_session):
    import json as _json
    import os
    from pathlib import Path

    _seed_rich(db_session)
    name = write_snapshot(db_session, actor="a@x.local")
    path = Path(os.environ["SNAPSHOT_DIR"]) / name
    data = _json.loads(path.read_text())
    for row in data["items"]:
        row.pop("assignee_id", None)
        row["assignee"] = "Legacy Name"
    path.write_text(_json.dumps(data))
    _wipe(db_session)

    body = client.post(f"/api/v1/import/snapshots/{name}/restore").json()
    assert "Legacy snapshot: assignee names were not restored" in body["warnings"]
    db_session.expire_all()
    assert all(i.assignee_id is None for i in db_session.query(Item))
