from pathlib import Path

from sqlalchemy import select

from app.models import Item, ItemKind, Team, TeamMember
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


def test_import_seeds_members_and_teams(client, db_session):
    with FIXTURE.open("rb") as fh:
        post_import(client, fh.read(), "p.csv")
    members = {m.name for m in db_session.scalars(select(TeamMember))}
    assert "Marco Wartmann" in members
    teams = {t.name for t in db_session.scalars(select(Team))}
    assert "Network" in teams


def test_reimport_is_idempotent_and_keeps_manual_members(client, db_session):
    db_session.add(TeamMember(name="Manual Person"))
    db_session.commit()
    for _ in range(2):
        with FIXTURE.open("rb") as fh:
            post_import(client, fh.read(), "p.csv")
    names = [m.name for m in db_session.scalars(select(TeamMember).order_by(TeamMember.name))]
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
