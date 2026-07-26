from pathlib import Path

from sqlalchemy import select

from app.models import Item, ItemKind, Team, User
from tests.import_helpers import post_import

FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def test_import_replaces_all_and_returns_counts(client, db_session):
    # pre-existing item should be wiped by replace-all
    db_session.add(Item(kind=ItemKind.FEATURE, type="Feature",
                        title="STALE", position=0))
    db_session.commit()

    with FIXTURE.open("rb") as fh:
        resp = post_import(client, fh.read(), "team_planning.csv")

    assert resp.status_code == 200
    body = resp.json()
    assert body["risks"] == 9
    assert body["features"] > 0
    assert body["stories"] > 0
    assert db_session.query(Item).filter_by(title="STALE").count() == 0
    # stories are linked to a parent feature
    story = db_session.query(Item).filter_by(kind=ItemKind.STORY).first()
    assert story.parent_id is not None


def test_second_import_does_not_accumulate(client):
    with FIXTURE.open("rb") as fh:
        first = post_import(client, fh.read(), "p.csv").json()
    with FIXTURE.open("rb") as fh:
        second = post_import(client, fh.read(), "p.csv").json()
    assert first == second


def test_import_seeds_users_and_teams(client, db_session):
    with FIXTURE.open("rb") as fh:
        post_import(client, fh.read(), "p.csv")
    seeded = {
        u.display_name
        for u in db_session.scalars(select(User).where(User.email.is_(None)))
    }
    assert "Marco Wartmann" in seeded
    teams = {t.name for t in db_session.scalars(select(Team))}
    assert "Network" in teams


def test_reimport_is_idempotent_and_keeps_manual_users(client, db_session):
    assert client.post(
        "/api/v1/users", json={"display_name": "Manual Person"}
    ).status_code == 201
    for _ in range(2):
        with FIXTURE.open("rb") as fh:
            post_import(client, fh.read(), "p.csv")
    names = [m.display_name for m in db_session.scalars(select(User).order_by(User.display_name))]
    assert names.count("Marco Wartmann") == 1
    assert "Manual Person" in names


from pathlib import Path

_FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def test_import_seeds_planning_intervals(client):
    with _FIXTURE.open("rb") as f:
        assert post_import(client, f.read(), "p.csv").status_code == 200
    names = [p["name"] for p in client.get("/api/v1/planning-intervals").json()]
    assert "PI1-Q3" in names


def test_import_creates_login_less_users_and_links_assignees(client, db_session):
    from app.models import Item, User

    with FIXTURE.open("rb") as fh:
        assert post_import(client, fh.read()).status_code == 200
    marco = db_session.query(User).filter_by(display_name="Marco Wartmann").one()
    assert marco.email is None and marco.password_hash is None
    assert db_session.query(Item).filter_by(assignee_id=marco.id).count() > 0


def test_import_warns_on_destroyed_roadmap_and_pi_objective_links(client, db_session):
    """replace_all's items wipe CASCADE-deletes roadmap_item_features and
    pi_objective_features rows in Postgres; the import result should warn
    about that loss since the freshly-imported items are new records."""
    from datetime import date

    from app.models import (
        Art,
        PIObjective,
        PlanningInterval,
        Product,
        RoadmapItem,
        Stream,
        pi_objective_features,
        roadmap_item_features,
    )

    feature = Item(kind=ItemKind.FEATURE, title="Doomed feature", position=0)
    db_session.add(feature)
    db_session.flush()

    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="Network", art_id=art.id)
    db_session.add(product)
    db_session.flush()
    stream = Stream(name="Campus", product_id=product.id)
    db_session.add(stream)
    db_session.flush()
    roadmap_item = RoadmapItem(
        title="Rollout", stream_id=stream.id,
        start_date=date(2026, 1, 1), end_date=date(2026, 6, 30),
    )
    db_session.add(roadmap_item)
    db_session.flush()
    db_session.execute(roadmap_item_features.insert().values(
        roadmap_item_id=roadmap_item.id, feature_id=feature.id))

    team = Team(name="Network")
    pi = PlanningInterval(name="PI1-Q3", position=1)
    db_session.add_all([team, pi])
    db_session.flush()
    objective = PIObjective(team_id=team.id, planning_interval_id=pi.id, title="Ship it")
    db_session.add(objective)
    db_session.flush()
    db_session.execute(pi_objective_features.insert().values(
        pi_objective_id=objective.id, item_id=feature.id))
    db_session.commit()

    with FIXTURE.open("rb") as fh:
        resp = post_import(client, fh.read(), "team_planning.csv")

    assert resp.status_code == 200
    warnings = resp.json()["warnings"]
    assert "1 roadmap feature link(s) removed — imported items are new records" in warnings
    assert "1 PI objective feature link(s) removed — imported items are new records" in warnings
