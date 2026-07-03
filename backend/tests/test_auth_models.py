from datetime import datetime, timedelta, timezone

from app.models import User, UserSession


def _utcnow() -> datetime:
    # naive UTC, matching the DateTime columns (datetime.utcnow() is deprecated)
    return datetime.now(timezone.utc).replace(tzinfo=None)


def test_user_and_session_roundtrip(db_session):
    user = User(email="a@b.ch", display_name="A", password_hash="x", role="admin")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert user.id is not None
    assert user.is_active is True
    assert user.auth_provider == "local"

    sess = UserSession(
        token_hash="h" * 64,
        user_id=user.id,
        expires_at=_utcnow() + timedelta(days=14),
    )
    db_session.add(sess)
    db_session.commit()
    db_session.refresh(sess)
    assert sess.id is not None
    assert sess.created_at is not None


def test_user_has_username_column(db_session):
    u = User(username="jdoe", display_name="J", email="j@x.ch")
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    assert u.username == "jdoe"


def test_user_team_relationship_and_name(db_session):
    from app.models import Team

    team = Team(name="Network")
    db_session.add(team)
    db_session.commit()

    user = User(email="t@x.ch", display_name="T", password_hash=None, team_id=team.id)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert user.team_name == "Network"

    loner = User(email="n@x.ch", display_name="N", password_hash=None)
    db_session.add(loner)
    db_session.commit()
    assert loner.team_name is None
