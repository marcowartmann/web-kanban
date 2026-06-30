from app.models import Item, ItemKind


def test_item_parent_child_round_trip(db_session):
    feature = Item(kind=ItemKind.FEATURE, type="Enabler Feature",
                   title="Feature A", status="Analyzing", position=0)
    db_session.add(feature)
    db_session.flush()
    story = Item(kind=ItemKind.STORY, type="Enabler Story", title="Story 1",
                 status="Analyzing", position=0, parent_id=feature.id)
    db_session.add(story)
    db_session.commit()

    loaded = db_session.get(Item, feature.id)
    assert loaded.children[0].title == "Story 1"


def test_feature_delete_cascades_to_children(db_session):
    feature = Item(kind=ItemKind.FEATURE, type="Feature", title="F", position=0)
    feature.children.append(
        Item(kind=ItemKind.STORY, type="Enabler Story", title="S", position=0)
    )
    db_session.add(feature)
    db_session.commit()
    fid = feature.id

    db_session.delete(feature)
    db_session.commit()
    assert db_session.query(Item).count() == 0
    assert db_session.get(Item, fid) is None
