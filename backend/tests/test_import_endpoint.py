from pathlib import Path

from sqlalchemy import select

from app.models import Item, ItemKind, Team, TeamMember

FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def test_import_replaces_all_and_returns_counts(client, db_session):
    # pre-existing item should be wiped by replace-all
    db_session.add(Item(kind=ItemKind.FEATURE, type="Feature",
                        title="STALE", position=0))
    db_session.commit()

    with FIXTURE.open("rb") as fh:
        resp = client.post("/api/import",
                           files={"file": ("team_planning.csv", fh, "text/csv")})

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
        first = client.post("/api/import",
                           files={"file": ("p.csv", fh, "text/csv")}).json()
    with FIXTURE.open("rb") as fh:
        second = client.post("/api/import",
                            files={"file": ("p.csv", fh, "text/csv")}).json()
    assert first == second


def test_import_seeds_members_and_teams(client, db_session):
    with FIXTURE.open("rb") as fh:
        client.post("/api/import", files={"file": ("p.csv", fh, "text/csv")})
    members = {m.name for m in db_session.scalars(select(TeamMember))}
    assert "Marco Wartmann" in members
    teams = {t.name for t in db_session.scalars(select(Team))}
    assert "Network" in teams


def test_reimport_is_idempotent_and_keeps_manual_members(client, db_session):
    db_session.add(TeamMember(name="Manual Person"))
    db_session.commit()
    for _ in range(2):
        with FIXTURE.open("rb") as fh:
            client.post("/api/import", files={"file": ("p.csv", fh, "text/csv")})
    names = [m.name for m in db_session.scalars(select(TeamMember).order_by(TeamMember.name))]
    assert names.count("Marco Wartmann") == 1
    assert "Manual Person" in names


from pathlib import Path

_FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def test_import_seeds_planning_intervals(client):
    with _FIXTURE.open("rb") as f:
        assert client.post("/api/import", files={"file": ("p.csv", f, "text/csv")}).status_code == 200
    names = [p["name"] for p in client.get("/api/planning-intervals").json()]
    assert "PI1-Q3" in names
