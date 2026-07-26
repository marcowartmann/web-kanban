from datetime import date

from app.catalog.domain import RoadmapStatus
from app.models import Art, Item, ItemKind, Product, RoadmapItem, Stream, roadmap_item_features


def test_roadmap_roundtrip(db_session):
    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="Network", art_id=art.id)
    db_session.add(product)
    db_session.flush()
    stream = Stream(name="Campus access", product_id=product.id, position=1)
    db_session.add(stream)
    db_session.flush()
    item = RoadmapItem(title="Wi-Fi 7 rollout", stream_id=stream.id,
                       status=RoadmapStatus.COMMITTED,
                       start_date=date(2026, 1, 1), end_date=date(2026, 6, 30))
    feature = Item(kind=ItemKind.FEATURE, title="Wi-Fi 7 APs")
    db_session.add_all([item, feature])
    db_session.flush()
    db_session.execute(roadmap_item_features.insert().values(
        roadmap_item_id=item.id, feature_id=feature.id))
    db_session.commit()

    assert stream.product.name == "Network"
    assert item.stream.name == "Campus access"


def test_status_persists_value(db_session):
    from sqlalchemy import text

    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="P", art_id=art.id)
    db_session.add(product)
    db_session.flush()
    stream = Stream(name="S", product_id=product.id)
    db_session.add(stream)
    db_session.flush()
    item = RoadmapItem(title="X", stream_id=stream.id, status=RoadmapStatus.COMMITTED,
                       start_date=date(2026, 1, 1), end_date=date(2026, 1, 2))
    db_session.add(item)
    db_session.commit()
    raw = db_session.execute(
        text("SELECT status FROM roadmap_items WHERE id = :i"), {"i": item.id}
    ).scalar_one()
    assert raw == "committed"
