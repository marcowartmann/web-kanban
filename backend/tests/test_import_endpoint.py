from pathlib import Path

from app.models import Item, ItemKind

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
