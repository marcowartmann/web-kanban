from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth import hash_password, require_admin
from app.db import get_db
from app.models import Team, User, UserSession
from app.schemas import UserCreate, UserRead, UserUpdate

router = APIRouter(
    prefix="/api/users", tags=["users"], dependencies=[Depends(require_admin)]
)


def _get_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db)) -> list[User]:
    return list(db.scalars(select(User).order_by(User.display_name)))


@router.post("", response_model=UserRead, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db)) -> User:
    email = payload.email.strip().lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status_code=409, detail="Email already in use")
    if payload.team_id is not None and db.get(Team, payload.team_id) is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    user = User(
        email=email,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        team_id=payload.team_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> User:
    user = _get_or_404(db, user_id)
    changes = payload.model_dump(exclude_unset=True)
    if user.id == current.id and (
        changes.get("role") == "member" or changes.get("is_active") is False
    ):
        raise HTTPException(status_code=422, detail="Admins cannot demote or deactivate themselves")
    email = changes.pop("email", None)
    if email is not None:
        email = email.strip().lower()
        if db.scalar(
            select(User).where(func.lower(User.email) == email, User.id != user.id)
        ):
            raise HTTPException(status_code=409, detail="Email already in use")
        user.email = email
    if "team_id" in changes:  # distinguishes "not sent" from explicit null
        team_id = changes.pop("team_id")
        if team_id is not None and db.get(Team, team_id) is None:
            raise HTTPException(status_code=422, detail="team_id does not exist")
        user.team_id = team_id
    password = changes.pop("password", None)
    for key, value in changes.items():
        setattr(user, key, value)
    if password is not None:
        user.password_hash = hash_password(password)
    # Password reset and deactivation both invalidate every session of the user.
    if password is not None or changes.get("is_active") is False:
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
    db.refresh(user)
    return user
