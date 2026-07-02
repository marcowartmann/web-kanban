from app.auth import ensure_initial_admin, verify_password
from app.config import settings
from app.models import User


def test_seeds_admin_once_into_empty_db(db_session):
    ensure_initial_admin(db_session)
    users = db_session.query(User).all()
    assert len(users) == 1
    admin = users[0]
    assert admin.email == settings.initial_admin_email
    assert admin.role == "admin"
    assert verify_password(settings.initial_admin_password, admin.password_hash)

    ensure_initial_admin(db_session)  # idempotent
    assert db_session.query(User).count() == 1


def test_noop_when_users_exist(db_session):
    db_session.add(User(email="x@x.ch", display_name="X", password_hash=None))
    db_session.commit()
    ensure_initial_admin(db_session)
    assert db_session.query(User).count() == 1
