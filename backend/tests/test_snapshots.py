import json
import os
from pathlib import Path

from app.models import Comment, Item, ItemKind, ItemLink, User
from app.snapshots import (
    FILENAME_RE,
    compute_state_stamp,
    list_snapshots,
    snapshot_path,
    write_snapshot,
)


def _seed(db):
    author = User(email="c@x.local", display_name="C", password_hash=None, role="member")
    db.add(author)
    db.flush()
    a = Item(kind=ItemKind.FEATURE, title="A", position=0, wsjf_score=3.5)
    db.add(a)
    db.flush()
    b = Item(kind=ItemKind.STORY, title="B", parent_id=a.id, position=0)
    db.add(b)
    db.flush()
    db.add(Comment(item_id=a.id, author_id=author.id, body="hello"))
    db.add(ItemLink(source_id=a.id, target_id=b.id, relation="blocks"))
    db.commit()
    return a, b


def _dir():
    return Path(os.environ["SNAPSHOT_DIR"])


def test_write_snapshot_contents(db_session):
    a, b = _seed(db_session)
    name = write_snapshot(db_session, actor="admin@x.local")
    assert FILENAME_RE.match(name)
    data = json.loads((_dir() / name).read_text())
    assert data["schema"] == 1
    assert data["actor"] == "admin@x.local"
    assert data["counts"] == {"items": 2, "comments": 1, "links": 1}
    items = {row["title"]: row for row in data["items"]}
    assert items["B"]["parent_id"] == a.id
    assert isinstance(items["A"]["kind"], str)          # raw persisted enum value
    assert items["A"]["wsjf_score"] == 3.5              # Decimal -> float
    assert isinstance(items["A"]["created_at"], str)    # datetime -> ISO string
    assert data["comments"][0]["body"] == "hello"
    assert data["links"][0]["relation"] == "blocks"


def test_write_snapshot_prunes_to_twenty(db_session):
    d = _dir()
    d.mkdir(parents=True, exist_ok=True)
    for i in range(22):
        (d / f"import-snapshot-20260101T0000{i:02d}-000000Z.json").write_text("{}")
    (d / "not-a-snapshot.json").write_text("{}")
    name = write_snapshot(db_session, actor="a@x.local")
    kept = sorted(p.name for p in d.iterdir() if FILENAME_RE.match(p.name))
    assert len(kept) == 20
    assert name in kept                       # newest survives
    assert kept[0] > "import-snapshot-20260101T000002-000000Z.json"  # oldest pruned
    assert (d / "not-a-snapshot.json").exists()  # non-matching files untouched


def test_list_snapshots_newest_first_with_metadata(db_session):
    _seed(db_session)
    first = write_snapshot(db_session, actor="one@x.local")
    second = write_snapshot(db_session, actor="two@x.local")
    listed = list_snapshots()
    assert [s["name"] for s in listed] == sorted([first, second], reverse=True)
    newest = listed[0]
    assert newest["actor"] in {"one@x.local", "two@x.local"}
    assert newest["items"] == 2 and newest["comments"] == 1 and newest["links"] == 1
    assert newest["created_at"]


def test_snapshot_path_rejects_bad_names(db_session):
    name = write_snapshot(db_session, actor="a@x.local")
    assert snapshot_path(name) is not None
    assert snapshot_path("../etc/passwd") is None
    assert snapshot_path("items.json") is None
    assert snapshot_path("import-snapshot-XXX.json") is None
    assert snapshot_path("import-snapshot-20990101T000000-000000Z.json") is None  # valid form, missing


def test_compute_state_stamp_moves_on_changes(client, db_session):
    stamps = [compute_state_stamp(db_session)]

    item = client.post("/api/v1/items", json={"kind": "feature", "title": "S"}).json()
    stamps.append(compute_state_stamp(db_session))

    client.patch(f"/api/v1/items/{item['id']}", json={"title": "S2", "version": 1})
    stamps.append(compute_state_stamp(db_session))

    other = client.post("/api/v1/items", json={"kind": "feature", "title": "T"}).json()
    client.post("/api/v1/links", json={"source_id": item["id"], "target_id": other["id"], "relation": "blocks"})
    stamps.append(compute_state_stamp(db_session))

    client.post(f"/api/v1/items/{item['id']}/comments", json={"body": "hi"})
    stamps.append(compute_state_stamp(db_session))

    assert len(set(stamps)) == len(stamps)
    assert all(len(s) == 16 for s in stamps)


def test_list_snapshots_skips_unreadable_files(db_session):
    _seed(db_session)
    good = write_snapshot(db_session, actor="a@x.local")
    d = _dir()
    (d / "import-snapshot-20260101T000000-000000Z.json").write_text("{corrupt")
    listed = list_snapshots()
    assert [s["name"] for s in listed] == [good]
