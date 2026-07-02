from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import (
    SESSION_COOKIE,
    create_session,
    hash_password,
    require_user,
    request_token,
    resolve_session_user,
    session_ttl,
    verify_password,
    _hash_token,
)
from app.config import settings
from app.db import get_db
from app.models import User, UserSession
from app.schemas import LoginRequest, PasswordChange, UserRead

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(session_ttl().total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.post("/login", response_model=UserRead)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> User:
    email = payload.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    # Identical 401 for unknown email / wrong password / inactive account.
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        log_event(
            db,
            actor=None,
            event_type="auth.login_failed",
            entity_type="auth",
            entity_label=email,
        )
        db.commit()  # the request fails — no mutation commit to ride
        raise HTTPException(status_code=401, detail="Invalid credentials")
    log_event(
        db,
        actor=user,
        event_type="auth.login",
        entity_type="auth",
        entity_id=user.id,
        entity_label=user.email,
    )
    token = create_session(db, user)  # commits, persisting the event atomically
    _set_session_cookie(response, token)
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    token = request_token(request)
    if token:
        user = resolve_session_user(db, token)
        if user is not None:
            log_event(
                db,
                actor=user,
                event_type="auth.logout",
                entity_type="auth",
                entity_id=user.id,
                entity_label=user.email,
            )
        db.execute(delete(UserSession).where(UserSession.token_hash == _hash_token(token)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(require_user)) -> User:
    return user


@router.patch("/me/password", status_code=204)
def change_my_password(
    payload: PasswordChange,
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> None:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    token = request_token(request)
    # Revoke every other session of this user; the current one stays valid.
    stmt = delete(UserSession).where(UserSession.user_id == user.id)
    if token:
        stmt = stmt.where(UserSession.token_hash != _hash_token(token))
    db.execute(stmt)
    log_event(
        db,
        actor=user,
        event_type="user.password_changed",
        entity_type="user",
        entity_id=user.id,
        entity_label=user.email,
        field="password",
        old_value="***",
        new_value="***",
    )
    db.commit()
