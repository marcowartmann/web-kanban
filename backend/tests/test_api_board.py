from app.models import Item, ItemKind


def _seed(db):
    feature = Item(kind=ItemKind.FEATURE, type="Feature", title="F1",
                   status="Analyzing", position=0)
    feature.children.append(
        Item(kind=ItemKind.STORY, type="Enabler Story", title="S1",
             position=0, story_points=0.5))
    feature.children.append(
        Item(kind=ItemKind.STORY, type="Enabler Story", title="S2",
             position=1, story_points=1.5))
    db.add(feature)
    db.add(Item(kind=ItemKind.RISK, type="Risk", title="R1",
               status="New", position=0))
    db.add(Item(kind=ItemKind.FEATURE, type="Feature", title="F2",
               status="", position=1))
    db.commit()


def test_board_groups_and_orders_columns(client, db_session):
    _seed(db_session)
    columns = client.get("/api/board").json()
    statuses = [c["status"] for c in columns]
    assert statuses[:2] == ["Analyzing", "New"]  # Funnel absent here
    assert "Unscheduled" in statuses


def test_board_card_aggregates_children(client, db_session):
    _seed(db_session)
    columns = client.get("/api/board").json()
    analyzing = next(c for c in columns if c["status"] == "Analyzing")
    card = analyzing["cards"][0]
    assert card["children_count"] == 2
    assert card["children_points"] == 2.0


def test_board_excludes_child_stories_as_cards(client, db_session):
    _seed(db_session)
    columns = client.get("/api/board").json()
    titles = [card["title"] for col in columns for card in col["cards"]]
    assert "S1" not in titles and "S2" not in titles
