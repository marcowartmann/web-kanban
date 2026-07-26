from datetime import date

import pytest

from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresProductRepository,
    PostgresRoadmapItemRepository,
    PostgresStreamRepository,
)
from app.catalog.domain import (
    CatalogInUse,
    CatalogNotFound,
    CatalogRuleViolation,
    RoadmapStatus,
)
from app.models import Item, ItemKind

D1, D2 = date(2026, 1, 1), date(2026, 6, 30)


@pytest.fixture()
def env(db_session):
    arts = PostgresArtRepository(db_session)
    products = PostgresProductRepository(db_session)
    art = arts.create(name="ART")
    product = products.create(name="Network", art_id=art.id)
    return {
        "db": db_session, "products": products, "product": product,
        "streams": PostgresStreamRepository(db_session),
        "items": PostgresRoadmapItemRepository(db_session),
    }


def test_stream_crud_and_positions(env):
    streams = env["streams"]
    pid = env["product"].id
    s1 = streams.create(name="Campus", product_id=pid)
    s2 = streams.create(name="Backbone", product_id=pid)
    assert (s1.position, s2.position) == (0, 1)
    with pytest.raises(CatalogRuleViolation):
        streams.create(name="Campus", product_id=pid)
    streams.update(s2.id, {"position": 0, "name": "Backbone Net"})
    listed = streams.list(pid)
    assert [s.name for s in listed] == ["Backbone Net", "Campus"]
    streams.delete(s2.id)
    with pytest.raises(CatalogNotFound):
        streams.get(s2.id)


def test_item_crud_dates_and_grouping(env):
    streams, items = env["streams"], env["items"]
    s = streams.create(name="Campus", product_id=env["product"].id)
    with pytest.raises(CatalogRuleViolation):
        items.create(title="Bad", stream_id=s.id, start_date=D2, end_date=D1)
    b = items.create(title="B", stream_id=s.id, start_date=date(2026, 3, 1), end_date=D2)
    a = items.create(title="A", stream_id=s.id, start_date=D1, end_date=D2,
                     status=RoadmapStatus.COMMITTED)
    listed = streams.list(env["product"].id)[0]
    assert [i.title for i in listed.items] == ["A", "B"]
    with pytest.raises(CatalogRuleViolation):
        items.update(b.id, {"end_date": date(2026, 2, 1)})  # would invert vs start 03-01
    items.update(b.id, {"start_date": date(2026, 2, 1), "end_date": date(2026, 2, 1)})
    assert items.get(b.id).start_date == date(2026, 2, 1)
    assert a.status == RoadmapStatus.COMMITTED


def test_stream_move_same_product_rule(env):
    arts = PostgresArtRepository(env["db"])
    other = env["products"].create(name="Other", art_id=arts.list()[0].id)
    s1 = env["streams"].create(name="Campus", product_id=env["product"].id)
    foreign = env["streams"].create(name="Foreign", product_id=other.id)
    item = env["items"].create(title="X", stream_id=s1.id, start_date=D1, end_date=D2)
    with pytest.raises(CatalogRuleViolation):
        env["items"].update(item.id, {"stream_id": foreign.id})
    s2 = env["streams"].create(name="Backbone", product_id=env["product"].id)
    assert env["items"].update(item.id, {"stream_id": s2.id}).stream_id == s2.id


def test_feature_links(env):
    s = env["streams"].create(name="Campus", product_id=env["product"].id)
    item = env["items"].create(title="X", stream_id=s.id, start_date=D1, end_date=D2)
    feature = Item(kind=ItemKind.FEATURE, title="Wi-Fi 7 APs", status="New")
    story = Item(kind=ItemKind.STORY, title="Not linkable")
    env["db"].add_all([feature, story])
    env["db"].flush()
    got = env["items"].link_feature(item.id, feature.id)
    assert [f.title for f in got.features] == ["Wi-Fi 7 APs"]
    assert got.features[0].status == "New"
    with pytest.raises(CatalogRuleViolation):
        env["items"].link_feature(item.id, feature.id)  # duplicate
    with pytest.raises(CatalogRuleViolation):
        env["items"].link_feature(item.id, story.id)  # not a feature
    got = env["items"].unlink_feature(item.id, feature.id)
    assert got.features == []
    with pytest.raises(CatalogNotFound):
        env["items"].unlink_feature(item.id, feature.id)


def test_guards(env):
    streams = env["streams"]
    s = streams.create(name="Campus", product_id=env["product"].id)
    env["items"].create(title="X", stream_id=s.id, start_date=D1, end_date=D2)
    with pytest.raises(CatalogInUse):
        streams.delete(s.id)
    with pytest.raises(CatalogInUse):
        env["products"].delete(env["product"].id)  # has streams


def test_item_delete_removes_links(env):
    from sqlalchemy import func, select
    from app.models import roadmap_item_features

    s = env["streams"].create(name="Campus", product_id=env["product"].id)
    item = env["items"].create(title="X", stream_id=s.id, start_date=D1, end_date=D2)
    feature = Item(kind=ItemKind.FEATURE, title="F")
    env["db"].add(feature)
    env["db"].flush()
    env["items"].link_feature(item.id, feature.id)
    env["items"].delete(item.id)
    assert env["db"].scalar(select(func.count()).select_from(roadmap_item_features)) == 0
