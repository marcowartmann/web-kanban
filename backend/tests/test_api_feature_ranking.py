from app.auth import get_current_user
from app.main import app
from app.models import Item, ItemKind, Team, User


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def _team(db, name):
    t = Team(name=name)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _user(db, team=None, role="member"):
    u = User(display_name="U", username=f"u{team.id if team else 0}", role=role,
             team_id=team.id if team else None)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _feat(db, title, team_name, wsjf=None, rank=None):
    f = Item(kind=ItemKind.FEATURE, title=title, position=0, leading_team=team_name,
             wsjf_score=wsjf, manual_rank=rank)
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


def test_reorder_renumbers_and_moves(anon_client, db_session):
    net = _team(db_session, "Net")
    user = _user(db_session, team=net)
    a = _feat(db_session, "A", "Net", wsjf=10)
    b = _feat(db_session, "B", "Net", wsjf=8)
    c = _feat(db_session, "C", "Net", wsjf=6)
    _as(user)
    # Move A to just after C: order becomes B, C, A
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": a.id, "after_id": c.id})
    assert resp.status_code == 204
    db_session.expire_all()
    ranks = {f.title: f.manual_rank for f in db_session.query(Item).all()}
    assert ranks == {"B": 1, "C": 2, "A": 3}
    app.dependency_overrides.clear()


def test_reorder_after_none_moves_to_top(anon_client, db_session):
    net = _team(db_session, "Net")
    user = _user(db_session, team=net)
    a = _feat(db_session, "A", "Net", wsjf=10)
    b = _feat(db_session, "B", "Net", wsjf=8)
    _as(user)
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": b.id, "after_id": None})
    assert resp.status_code == 204
    db_session.expire_all()
    assert db_session.get(Item, b.id).manual_rank == 1
    app.dependency_overrides.clear()


def test_reorder_wrong_team_is_403(anon_client, db_session):
    net = _team(db_session, "Net")
    cloud = _team(db_session, "Cloud")
    user = _user(db_session, team=cloud)
    a = _feat(db_session, "A", "Net", wsjf=10)
    _as(user)
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": a.id, "after_id": None})
    assert resp.status_code == 403
    app.dependency_overrides.clear()


def test_reorder_no_team_is_403(anon_client, db_session):
    user = _user(db_session, team=None)
    a = _feat(db_session, "A", "Net", wsjf=10)
    _as(user)
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": a.id, "after_id": None})
    assert resp.status_code == 403
    app.dependency_overrides.clear()


def test_reorder_unknown_feature_404(anon_client, db_session):
    net = _team(db_session, "Net")
    user = _user(db_session, team=net)
    _as(user)
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": 9999, "after_id": None})
    assert resp.status_code == 404
    app.dependency_overrides.clear()


def test_reorder_non_feature_422(anon_client, db_session):
    net = _team(db_session, "Net")
    user = _user(db_session, team=net)
    story = Item(kind=ItemKind.STORY, title="S", position=0, leading_team="Net")
    db_session.add(story)
    db_session.commit()
    db_session.refresh(story)
    _as(user)
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": story.id, "after_id": None})
    assert resp.status_code == 422
    app.dependency_overrides.clear()


def test_reorder_materializes_default_wsjf_order(anon_client, db_session):
    net = _team(db_session, "Net")
    user = _user(db_session, team=net)
    # All ranks null; wsjf desc default = high, mid, low
    high = _feat(db_session, "high", "Net", wsjf=20)
    mid = _feat(db_session, "mid", "Net", wsjf=10)
    low = _feat(db_session, "low", "Net", wsjf=5)
    _as(user)
    # Move low to top → low, high, mid
    resp = anon_client.post("/api/v1/features/ranking/reorder",
                            json={"feature_id": low.id, "after_id": None})
    assert resp.status_code == 204
    db_session.expire_all()
    ranks = {f.title: f.manual_rank for f in db_session.query(Item).all()}
    assert ranks == {"low": 1, "high": 2, "mid": 3}
    app.dependency_overrides.clear()
