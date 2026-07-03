import hashlib
import secrets
from datetime import timedelta

import bcrypt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User, UserSession
from app.timeutil import utcnow

SESSION_COOKIE = "kanban_session"


def session_ttl() -> timedelta:
    return timedelta(days=settings.session_ttl_days)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:  # IdP-managed accounts have no local password
        return False
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:  # oversized (>72 bytes) or malformed inputs are just "wrong"
        return False


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: Session, user: User) -> str:
    # Opportunistic cleanup of this user's expired sessions.
    db.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id, UserSession.expires_at < utcnow()
        )
    )
    token = secrets.token_urlsafe(32)
    db.add(
        UserSession(
            token_hash=_hash_token(token),
            user_id=user.id,
            expires_at=utcnow() + session_ttl(),
        )
    )
    db.commit()
    return token


def resolve_session_user(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == _hash_token(token)))
    if sess is None or sess.expires_at < utcnow():
        return None
    user = db.get(User, sess.user_id)
    if user is None or not user.is_active:
        return None
    # Sliding TTL: extend when less than half the window remains.
    if sess.expires_at - utcnow() < session_ttl() / 2:
        sess.expires_at = utcnow() + session_ttl()
        db.commit()
    return user


def request_token(request: Request) -> str | None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        return token
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header.removeprefix("Bearer ").strip()
    return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    return resolve_session_user(db, request_token(request))


def require_user(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def find_or_provision_ldap_user(db: Session, identity) -> User | None:
    """Return the LDAP-backed User for this identity, creating it on first login.
    Returns None if the username is already taken by a non-LDAP account."""
    email = identity.email.strip().lower() if identity.email else None
    user = db.scalar(select(User).where(User.username == identity.uid))
    if user is not None:
        if user.auth_provider != "ldap":
            return None  # username owned by a local account — do not cross providers
        user.display_name = identity.display_name or user.display_name
        # Only adopt the directory email if it is free (email is unique).
        if email and not db.scalar(
            select(User.id).where(User.email == email, User.id != user.id)
        ):
            user.email = email
        return user
    if email and db.scalar(select(User.id).where(User.email == email)):
        email = None  # avoid violating the unique email constraint
    user = User(
        username=identity.uid,
        email=email,
        display_name=identity.display_name or identity.uid,
        password_hash=None,
        role="member",
        auth_provider="ldap",
    )
    db.add(user)
    db.flush()
    return user


def ensure_initial_admin(db: Session) -> None:
    """Seed the first admin from settings. Idempotent; no-op once any user exists."""
    if db.scalar(select(User.id).limit(1)) is not None:
        return
    db.add(
        User(
            email=settings.initial_admin_email.strip().lower(),
            username=settings.initial_admin_username.strip(),
            display_name=settings.initial_admin_name,
            password_hash=hash_password(settings.initial_admin_password),
            role="admin",
        )
    )
    db.commit()
