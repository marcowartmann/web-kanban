from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import hash_password, require_admin, require_user
from app.db import get_db
from app.models import Team, TeamDepartment, User, UserSession
from app.schemas import PersonOption, UserCreate, UserDepartments, UserRead, UserUpdate

router = APIRouter(prefix="/api/v1/users", tags=["users"])


def _get_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _team_label(db: Session, team_id: int | None) -> str | None:
    if team_id is None:
        return None
    team = db.get(Team, team_id)
    return team.name if team else str(team_id)


@router.get("/options", response_model=list[PersonOption])
def user_options(
    db: Session = Depends(get_db), current: User = Depends(require_user)
) -> list[User]:
    return list(db.scalars(select(User).order_by(User.display_name)))


@router.get("", response_model=list[UserRead], dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)) -> list[User]:
    return list(db.scalars(select(User).order_by(User.display_name)))


@router.post("", response_model=UserRead, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> User:
    email = (payload.email or "").strip().lower() or None  # whitespace-only -> None
    username = (payload.username or "").strip() or None
    if payload.password is not None and username is None:
        raise HTTPException(status_code=422, detail="Password requires a username")
    if email and db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status_code=409, detail="Email already in use")
    if username and db.scalar(select(User).where(User.username == username)):
        raise HTTPException(status_code=409, detail="Username already in use")
    if payload.team_id is not None and db.get(Team, payload.team_id) is None:
        raise HTTPException(status_code=422, detail="team_id does not exist")
    user = User(
        email=email,
        username=username,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password) if payload.password else None,
        role=payload.role,
        team_id=payload.team_id,
    )
    db.add(user)
    db.flush()
    log_event(
        db,
        actor=current,
        event_type="user.created",
        entity_type="user",
        entity_id=user.id,
        entity_label=user.email or user.display_name,
    )
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
    audited = {}
    for key in ("email", "username", "display_name", "role", "is_active", "team_id"):
        if key in changes:
            audited[key] = getattr(user, key)
    if "email" in changes:
        email = changes.pop("email")
        if email is not None:
            email = email.strip().lower() or None  # whitespace-only counts as clearing
        if email is None:
            user.email = None  # email is optional and independent of the password
        else:
            if db.scalar(
                select(User).where(func.lower(User.email) == email, User.id != user.id)
            ):
                raise HTTPException(status_code=409, detail="Email already in use")
            user.email = email
    if "username" in changes:
        raw = changes.get("username")
        norm = (raw.strip() if raw else "") or None
        changes["username"] = norm
        if norm and db.scalar(
            select(User).where(User.username == norm, User.id != user.id)
        ):
            raise HTTPException(status_code=409, detail="Username already in use")
    if "team_id" in changes:  # distinguishes "not sent" from explicit null
        team_id = changes.pop("team_id")
        if team_id is not None and db.get(Team, team_id) is None:
            raise HTTPException(status_code=422, detail="team_id does not exist")
        user.team_id = team_id
    password = changes.pop("password", None)
    # A password-bearing account must keep a username. Only enforce when the
    # request actually touches the username or the password, so unrelated edits
    # (deactivate, team, role) on any legacy row are untouched.
    if "username" in changes or password is not None:
        final_username = changes["username"] if "username" in changes else user.username
        if (user.password_hash is not None or password is not None) and final_username is None:
            raise HTTPException(status_code=422, detail="Password requires a username")
    for key, value in changes.items():
        setattr(user, key, value)
    if password is not None:
        user.password_hash = hash_password(password)
    for key, old in audited.items():
        new = getattr(user, key)
        if old == new:
            continue
        old_out, new_out = old, new
        if key == "team_id":
            old_out, new_out = _team_label(db, old), _team_label(db, new)
        log_event(
            db,
            actor=current,
            event_type="user.updated",
            entity_type="user",
            entity_id=user.id,
            entity_label=user.email or user.display_name,
            field=key,
            old_value=old_out,
            new_value=new_out,
        )
    if password is not None:
        log_event(
            db,
            actor=current,
            event_type="user.updated",
            entity_type="user",
            entity_id=user.id,
            entity_label=user.email or user.display_name,
            field="password",
            old_value="***",
            new_value="***",
        )
    # Password reset and deactivation both invalidate every session of the user.
    if password is not None or changes.get("is_active") is False:
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}/departments", response_model=UserRead, dependencies=[Depends(require_admin)])
def set_user_departments(
    user_id: int,
    payload: UserDepartments,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> User:
    user = _get_or_404(db, user_id)
    departments = []
    for dep_id in payload.department_ids:
        dep = db.get(TeamDepartment, dep_id)
        if dep is None:
            raise HTTPException(status_code=422, detail=f"department {dep_id} does not exist")
        departments.append(dep)
    user.departments = departments
    log_event(db, actor=current, event_type="user.departments_changed", entity_type="user",
              entity_id=user.id, entity_label=user.email or user.display_name)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    user = _get_or_404(db, user_id)
    if user.id == current.id:
        raise HTTPException(status_code=422, detail="Admins cannot delete themselves")
    from app.models import Comment, Item

    comments = db.scalar(
        select(func.count()).select_from(Comment).where(Comment.author_id == user.id)
    )
    if comments:
        raise HTTPException(
            status_code=409,
            detail=f"User '{user.display_name}' has {comments} comments — deactivate instead",
        )
    if not force:
        assigned = db.scalar(
            select(func.count()).select_from(Item).where(Item.assignee_id == user.id)
        )
        if assigned:
            raise HTTPException(
                status_code=409,
                detail=f"User '{user.display_name}' is assigned to {assigned} items",
            )
    # Core UPDATE: bumps items.updated_at (Python onupdate) without an audit row,
    # and deliberately does NOT bump version (a version bump here would spuriously
    # 409 unrelated concurrent edits). SQLite tests don't enforce FK ondelete,
    # hence the explicit null-out; on Postgres the FK's SET NULL also applies.
    db.execute(update(Item).where(Item.assignee_id == user.id).values(assignee_id=None))
    log_event(
        db,
        actor=current,
        event_type="user.deleted",
        entity_type="user",
        entity_id=user.id,
        entity_label=user.email or user.display_name,
    )
    db.delete(user)
    db.commit()
