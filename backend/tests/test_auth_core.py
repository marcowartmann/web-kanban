import hashlib
from datetime import timedelta

from app.auth import (
    create_session,
    hash_password,
    resolve_session_user,
    utcnow,
    verify_password,
)
from app.models import User, UserSession


def _user(db, **over):
    defaults = dict(email="u@x.ch", display_name="U", password_hash=hash_password("secret123"))
    defaults.update(over)
    user = User(**defaults)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_password_hash_roundtrip():
    hashed = hash_password("secret123")
    assert hashed != "secret123"
    assert verify_password("secret123", hashed)
    assert not verify_password("wrong", hashed)
    assert not verify_password("anything", None)  # IdP users have no hash


def test_create_session_stores_sha256_only(db_session):
    user = _user(db_session)
    token = create_session(db_session, user)
    assert len(token) >= 40
    sess = db_session.query(UserSession).one()
    assert sess.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert sess.user_id == user.id


def test_resolve_session_user(db_session):
    user = _user(db_session)
    token = create_session(db_session, user)
    assert resolve_session_user(db_session, token).id == user.id
    assert resolve_session_user(db_session, "nonsense") is None
    assert resolve_session_user(db_session, None) is None


def test_resolve_rejects_expired_and_inactive(db_session):
    user = _user(db_session)
    token = create_session(db_session, user)
    sess = db_session.query(UserSession).one()
    sess.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    assert resolve_session_user(db_session, token) is None

    token2 = create_session(db_session, user)
    user.is_active = False
    db_session.commit()
    assert resolve_session_user(db_session, token2) is None


def test_sliding_renewal_extends_when_half_elapsed(db_session):
    user = _user(db_session)
    token = create_session(db_session, user)
    sess = db_session.query(UserSession).filter_by(user_id=user.id).one()
    sess.expires_at = utcnow() + timedelta(days=1)  # far less than half of 14d left
    db_session.commit()
    assert resolve_session_user(db_session, token) is not None
    db_session.refresh(sess)
    assert sess.expires_at > utcnow() + timedelta(days=13)
