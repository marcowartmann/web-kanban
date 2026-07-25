from sqlalchemy import select

from app.models import Art, Item


def test_create_item_with_art_string_creates_art_row(client, db_session):
    resp = client.post("/api/v1/items", json={"kind": "feature", "title": "F1", "art": "Platform ART"})
    assert resp.status_code == 201
    assert resp.json()["art"] == "Platform ART"
    art = db_session.scalar(select(Art).where(Art.name == "Platform ART"))
    assert art is not None
    item = db_session.get(Item, resp.json()["id"])
    assert item.art_id == art.id
    assert item.art == "Platform ART"


def test_create_item_reuses_existing_art(client, db_session):
    db_session.add(Art(name="Platform ART"))
    db_session.commit()
    client.post("/api/v1/items", json={"kind": "feature", "title": "F1", "art": "Platform ART"})
    assert db_session.scalar(select(Art).where(Art.name == "Platform ART")) is not None
    assert len(list(db_session.scalars(select(Art)))) == 1


def test_create_item_without_art(client):
    resp = client.post("/api/v1/items", json={"kind": "feature", "title": "F1"})
    assert resp.status_code == 201
    assert resp.json()["art"] is None


def test_csv_insert_item_resolves_art(db_session):
    from app.csv_import import ParsedItem, _insert_item
    from app.models import ItemKind

    parsed = ParsedItem(kind=ItemKind.FEATURE, data={"title": "F", "art": "CSV ART"})
    item = _insert_item(db_session, parsed, parent_id=None, position=0, assignee_ids={})
    db_session.commit()
    assert item.art == "CSV ART"
    assert db_session.scalar(select(Art).where(Art.name == "CSV ART")) is not None


def test_get_or_create_art_id_strips_and_ignores_empty(db_session):
    from app.catalog.adapters.postgres import get_or_create_art_id

    assert get_or_create_art_id(db_session, None) is None
    assert get_or_create_art_id(db_session, "  ") is None
    a = get_or_create_art_id(db_session, "  ART X ")
    assert db_session.get(Art, a).name == "ART X"
    assert get_or_create_art_id(db_session, "ART X") == a


def test_snapshot_restore_maps_legacy_art_name(client, db_session):
    from app.snapshots import restore_from_snapshot

    data = {
        "items": [{"id": 1, "kind": "feature", "title": "Old", "art": "Legacy ART",
                   "position": 0, "version": 1, "parent_id": None,
                   "created_at": "2026-01-01T00:00:00+00:00",
                   "updated_at": "2026-01-01T00:00:00+00:00"}],
        "comments": [], "links": [],
    }
    restore_from_snapshot(db_session, data)
    db_session.commit()
    item = db_session.get(Item, 1)
    assert item.art == "Legacy ART"


def test_snapshot_restore_clears_dangling_art_id(client, db_session):
    from app.snapshots import restore_from_snapshot

    data = {
        "items": [{"id": 1, "kind": "feature", "title": "Old", "art_id": 999,
                   "position": 0, "version": 1, "parent_id": None,
                   "created_at": "2026-01-01T00:00:00+00:00",
                   "updated_at": "2026-01-01T00:00:00+00:00"}],
        "comments": [], "links": [],
    }
    restore_from_snapshot(db_session, data)
    db_session.commit()
    assert db_session.get(Item, 1).art is None
