from app.models import Item, ItemKind, ItemLink


def _item(db, kind, title):
    it = Item(kind=kind, title=title)
    db.add(it)
    db.commit()
    db.refresh(it)
    return it


def test_item_link_roundtrip(db_session):
    a = _item(db_session, ItemKind.FEATURE, "A")
    b = _item(db_session, ItemKind.STORY, "B")
    link = ItemLink(source_id=a.id, target_id=b.id, relation="blocks")
    db_session.add(link)
    db_session.commit()
    db_session.refresh(link)
    assert link.id is not None
    assert link.created_at is not None
    assert db_session.query(ItemLink).count() == 1
