# Item Comments & Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Items get one-level comment threads (comment → 0..n replies) with author + date on every entry, full edit/delete (author-or-admin), and audit-log integration.

**Architecture:** One self-referencing `comments` table (migration `0011`; item/parent FKs CASCADE, ORM `delete-orphan` mirrors `Item.children` so cascades are real in SQLite tests). A comments router (list/post/edit/delete) enforces the one-level rule and author-or-admin permissions and logs `comment.added|edited|deleted` onto the item via the existing `log_event`. The drawer gains a `Comments` section (`ItemComments.tsx`) with composer, inline reply/edit, and permission-gated actions via a new null-tolerant `useOptionalAuth`.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic (backend); React 18 + TS + Tailwind + vitest (frontend); Docker Compose.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-item-comments-design.md`. Branch `feat/item-comments` off `main`.
- Migration `0011_comments.py`, `revision = "0011"`, `down_revision = "0010"`; table `comments` (columns per spec), indexes `ix_comments_item_id`, `ix_comments_parent_id`, `ix_comments_author_id`.
- `body` bounds: `Field(min_length=1, max_length=4000)` on create AND update.
- Error strings verbatim: 422 `"parent_id does not exist"`, 422 `"parent belongs to a different item"`, 422 `"replies cannot be nested"`, 403 `"Not your comment"`.
- Permissions: `_can_modify(user, comment) = user.role == "admin" or comment.author_id == user.id` gates PATCH and DELETE; any authenticated user may GET/POST.
- Audit events (entity_type `item`, entity_id = item id, entity_label = item title, field `comment`, riding each endpoint's single commit): `comment.added` (new_value = excerpt), `comment.edited` (old + new excerpts), `comment.deleted` (old_value = excerpt + `" (+N replies)"` when N > 0). Excerpt = first 120 chars + `"…"` when truncated.
- `updated_at` set via the existing `app.auth.utcnow()` (naive UTC); NULL until first edit.
- GET ordering: `created_at ASC, id ASC` (flat; frontend groups by `parent_id`).
- Frontend: `useOptionalAuth` (returns `null` outside `AuthProvider`) — `ItemComments` must render read-only with a null user and degrade fetch errors, so the 5 pre-existing drawer test files pass UNMODIFIED.
- Suite baselines: backend 136, frontend 161. Expected: backend 145 after Task 2 (T1 +2, T2 +7); frontend 167 after Task 4 (T3 +5, T4 +1).
- ENV NOTE (backend tasks): container does NOT bind-mount backend code; before pytest:
  `docker compose exec -T backend sh -c 'rm -rf /app/app /app/alembic /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/alembic backend:/app/alembic && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend pip install -q "pytest>=8.2" "httpx>=0.27" "bcrypt>=4.1"`
- Frontend runs on the host (`cd frontend && npx vitest run && npx tsc --noEmit`).

---

### Task 1: `Comment` model + `Item.comments` + migration `0011`

**Files:**
- Modify: `backend/app/models.py` (append `Comment` after `AuditEvent`; add `comments` relationship to `Item`)
- Create: `backend/alembic/versions/0011_comments.py`
- Test: `backend/tests/test_comment_model.py`

**Interfaces:**
- Produces: `Comment` ORM model (`item_id`, `parent_id`, `author_id`, `body`, `created_at`, `updated_at`, `author` relationship, `replies` relationship, `author_name` property); `Item.comments` (delete-orphan). Task 2 builds the API on these.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_comment_model.py`:

```python
from app.models import Comment, Item, User


def _user(db, email="a@x.ch", name="Anna"):
    user = User(email=email, display_name=name, password_hash=None)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _item(db, title="F"):
    item = Item(kind="feature", title=title)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_comment_roundtrip_and_author_name(db_session):
    user = _user(db_session)
    item = _item(db_session)
    comment = Comment(item_id=item.id, author_id=user.id, body="Hello")
    db_session.add(comment)
    db_session.commit()
    db_session.refresh(comment)
    assert comment.id is not None
    assert comment.created_at is not None
    assert comment.updated_at is None
    assert comment.author_name == "Anna"


def test_orm_cascades(db_session):
    user = _user(db_session)
    item = _item(db_session)
    parent = Comment(item_id=item.id, author_id=user.id, body="parent")
    db_session.add(parent)
    db_session.commit()
    reply = Comment(item_id=item.id, author_id=user.id, parent_id=parent.id, body="reply")
    db_session.add(reply)
    db_session.commit()

    # Deleting the parent removes its replies (ORM delete-orphan).
    db_session.delete(parent)
    db_session.commit()
    assert db_session.query(Comment).count() == 0

    solo = Comment(item_id=item.id, author_id=user.id, body="solo")
    db_session.add(solo)
    db_session.commit()
    # Deleting the item removes its comments.
    db_session.delete(item)
    db_session.commit()
    assert db_session.query(Comment).count() == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/tests' && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_comment_model.py -q`
Expected: FAIL — `ImportError: cannot import name 'Comment'`.

- [ ] **Step 3: Add the model**

In `backend/app/models.py`, append after the `AuditEvent` class (all imports present):

```python
class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column()  # set on edit

    author: Mapped["User"] = relationship()
    replies: Mapped[list["Comment"]] = relationship(
        cascade="all, delete-orphan",
        order_by="Comment.id",
    )

    @property
    def author_name(self) -> str | None:
        return self.author.display_name if self.author else None
```

And inside the `Item` class, directly after the existing `children` relationship, add:

```python
    comments: Mapped[list["Comment"]] = relationship(
        cascade="all, delete-orphan",
    )
```

- [ ] **Step 4: Create the migration**

Create `backend/alembic/versions/0011_comments.py`:

```python
"""item comments and replies

Revision ID: 0011
Revises: 0010
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "comments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "item_id",
            sa.Integer,
            sa.ForeignKey("items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.Integer,
            sa.ForeignKey("comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "author_id",
            sa.Integer,
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=True),
    )
    op.create_index("ix_comments_item_id", "comments", ["item_id"])
    op.create_index("ix_comments_parent_id", "comments", ["parent_id"])
    op.create_index("ix_comments_author_id", "comments", ["author_id"])


def downgrade() -> None:
    op.drop_table("comments")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/app /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_comment_model.py -q`
Expected: PASS (2 passed).

- [ ] **Step 6: Apply the migration on Postgres**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/alembic' && docker compose cp ./backend/alembic backend:/app/alembic && docker compose exec -T backend alembic upgrade head && docker compose exec -T backend alembic current`
Expected: `0011 (head)`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/alembic/versions/0011_comments.py backend/tests/test_comment_model.py
git commit -m "feat(backend): comments model with one-level replies (migration 0011)"
```

---

### Task 2: Schemas + comments router (permissions, validation, audit)

**Files:**
- Modify: `backend/app/schemas.py` (append the three comment schemas)
- Create: `backend/app/routers/comments.py`
- Modify: `backend/app/main.py` (register in the protected loop)
- Test: `backend/tests/test_api_comments.py`

**Interfaces:**
- Consumes: `Comment`, `Item.comments` (Task 1); `log_event` (audit); `require_user`, `utcnow` (auth).
- Produces: `GET/POST /api/items/{item_id}/comments`, `PATCH/DELETE /api/comments/{comment_id}`; `CommentRead {id, item_id, parent_id, author_id, author_name, body, created_at, updated_at}`. Tasks 3–4 rely on these shapes.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_api_comments.py`:

```python
from app.auth import get_current_user, hash_password
from app.main import app
from app.models import AuditEvent, Comment, User


def _seed_user(db, email, role="member", name=None):
    user = User(
        email=email,
        display_name=name or email.split("@")[0],
        password_hash=hash_password("secret123"),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: user


def _item(client):
    return client.post("/api/items", json={"kind": "feature", "title": "F"}).json()["id"]


def test_post_and_list_threaded_order(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch", name="Anna")
    _as(author)
    item_id = _item(anon_client)
    first = anon_client.post(f"/api/items/{item_id}/comments", json={"body": "First!"})
    assert first.status_code == 201
    assert first.json()["author_name"] == "Anna"
    assert first.json()["updated_at"] is None
    reply = anon_client.post(
        f"/api/items/{item_id}/comments",
        json={"body": "A reply", "parent_id": first.json()["id"]},
    )
    assert reply.status_code == 201
    assert reply.json()["parent_id"] == first.json()["id"]
    second = anon_client.post(f"/api/items/{item_id}/comments", json={"body": "Second"})
    assert second.status_code == 201

    listed = anon_client.get(f"/api/items/{item_id}/comments").json()
    assert [c["body"] for c in listed] == ["First!", "A reply", "Second"]
    assert anon_client.get("/api/items/999/comments").status_code == 404


def test_reply_validations(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch")
    _as(author)
    item_a = _item(anon_client)
    item_b = _item(anon_client)
    parent = anon_client.post(f"/api/items/{item_a}/comments", json={"body": "p"}).json()
    reply = anon_client.post(
        f"/api/items/{item_a}/comments", json={"body": "r", "parent_id": parent["id"]}
    ).json()

    missing = anon_client.post(
        f"/api/items/{item_a}/comments", json={"body": "x", "parent_id": 999}
    )
    assert missing.status_code == 422
    cross = anon_client.post(
        f"/api/items/{item_b}/comments", json={"body": "x", "parent_id": parent["id"]}
    )
    assert cross.status_code == 422
    nested = anon_client.post(
        f"/api/items/{item_a}/comments", json={"body": "x", "parent_id": reply["id"]}
    )
    assert nested.status_code == 422
    assert nested.json()["detail"] == "replies cannot be nested"


def test_edit_permissions_and_marker(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch")
    other = _seed_user(db_session, "ben@x.ch")
    admin = _seed_user(db_session, "root@x.ch", role="admin")
    _as(author)
    item_id = _item(anon_client)
    comment = anon_client.post(f"/api/items/{item_id}/comments", json={"body": "v1"}).json()

    edited = anon_client.patch(f"/api/comments/{comment['id']}", json={"body": "v2"})
    assert edited.status_code == 200
    assert edited.json()["body"] == "v2"
    assert edited.json()["updated_at"] is not None

    _as(other)
    denied = anon_client.patch(f"/api/comments/{comment['id']}", json={"body": "hack"})
    assert denied.status_code == 403
    assert denied.json()["detail"] == "Not your comment"

    _as(admin)
    assert anon_client.patch(f"/api/comments/{comment['id']}", json={"body": "v3"}).status_code == 200
    assert anon_client.patch("/api/comments/999", json={"body": "x"}).status_code == 404


def test_delete_permissions_and_reply_cascade(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch")
    other = _seed_user(db_session, "ben@x.ch")
    admin = _seed_user(db_session, "root@x.ch", role="admin")
    _as(author)
    item_id = _item(anon_client)
    parent = anon_client.post(f"/api/items/{item_id}/comments", json={"body": "p"}).json()
    anon_client.post(f"/api/items/{item_id}/comments", json={"body": "r1", "parent_id": parent["id"]})
    anon_client.post(f"/api/items/{item_id}/comments", json={"body": "r2", "parent_id": parent["id"]})

    _as(other)
    assert anon_client.delete(f"/api/comments/{parent['id']}").status_code == 403

    _as(author)
    assert anon_client.delete(f"/api/comments/{parent['id']}").status_code == 204
    assert db_session.query(Comment).count() == 0  # replies cascaded

    other_comment = anon_client.post(f"/api/items/{item_id}/comments", json={"body": "mine"}).json()
    _as(admin)
    assert anon_client.delete(f"/api/comments/{other_comment['id']}").status_code == 204


def test_audit_events_with_excerpts(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch")
    _as(author)
    item_id = _item(anon_client)

    long_body = "x" * 150
    comment = anon_client.post(f"/api/items/{item_id}/comments", json={"body": long_body}).json()
    added = db_session.query(AuditEvent).filter_by(event_type="comment.added").one()
    assert added.entity_type == "item" and added.entity_id == item_id
    assert added.field == "comment"
    assert added.new_value == "x" * 120 + "…"

    anon_client.patch(f"/api/comments/{comment['id']}", json={"body": "short"})
    edited = db_session.query(AuditEvent).filter_by(event_type="comment.edited").one()
    assert edited.old_value == "x" * 120 + "…"
    assert edited.new_value == "short"

    anon_client.post(f"/api/items/{item_id}/comments", json={"body": "r", "parent_id": comment["id"]})
    anon_client.delete(f"/api/comments/{comment['id']}")
    deleted = db_session.query(AuditEvent).filter_by(event_type="comment.deleted").one()
    assert deleted.old_value == "short (+1 replies)"


def test_any_member_can_comment(member_client):
    item_id = member_client.post(
        "/api/items", json={"kind": "feature", "title": "M"}
    ).json()["id"]
    resp = member_client.post(f"/api/items/{item_id}/comments", json={"body": "hi"})
    assert resp.status_code == 201


def test_body_bounds(anon_client, db_session):
    author = _seed_user(db_session, "anna@x.ch")
    _as(author)
    item_id = _item(anon_client)
    assert anon_client.post(f"/api/items/{item_id}/comments", json={"body": ""}).status_code == 422
    assert (
        anon_client.post(f"/api/items/{item_id}/comments", json={"body": "y" * 4001}).status_code
        == 422
    )
```

NOTE: never use `member_client` and `anon_client`'s manual `_as(...)` overrides in the same test — the fixtures share the `get_current_user` override key.

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/tests' && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_comments.py -q`
Expected: FAIL — 404s (router not registered).

- [ ] **Step 3: Add the schemas**

Append to `backend/app/schemas.py`:

```python
class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_id: int
    parent_id: int | None
    author_id: int
    author_name: str | None
    body: str
    created_at: datetime
    updated_at: datetime | None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    parent_id: int | None = None


class CommentUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
```

- [ ] **Step 4: Create `backend/app/routers/comments.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_user, utcnow
from app.db import get_db
from app.models import Comment, Item, User
from app.schemas import CommentCreate, CommentRead, CommentUpdate

router = APIRouter(prefix="/api", tags=["comments"])


def _excerpt(body: str) -> str:
    return body[:120] + "…" if len(body) > 120 else body


def _can_modify(user: User, comment: Comment) -> bool:
    return user.role == "admin" or comment.author_id == user.id


def _item_or_404(db: Session, item_id: int) -> Item:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


def _comment_or_404(db: Session, comment_id: int) -> Comment:
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


@router.get("/items/{item_id}/comments", response_model=list[CommentRead])
def list_comments(item_id: int, db: Session = Depends(get_db)) -> list[Comment]:
    _item_or_404(db, item_id)
    return list(
        db.scalars(
            select(Comment)
            .where(Comment.item_id == item_id)
            .order_by(Comment.created_at.asc(), Comment.id.asc())
        )
    )


@router.post("/items/{item_id}/comments", response_model=CommentRead, status_code=201)
def create_comment(
    item_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> Comment:
    item = _item_or_404(db, item_id)
    if payload.parent_id is not None:
        parent = db.get(Comment, payload.parent_id)
        if parent is None:
            raise HTTPException(status_code=422, detail="parent_id does not exist")
        if parent.item_id != item_id:
            raise HTTPException(status_code=422, detail="parent belongs to a different item")
        if parent.parent_id is not None:
            raise HTTPException(status_code=422, detail="replies cannot be nested")
    comment = Comment(
        item_id=item_id,
        parent_id=payload.parent_id,
        author_id=current.id,
        body=payload.body,
    )
    db.add(comment)
    db.flush()
    log_event(
        db,
        actor=current,
        event_type="comment.added",
        entity_type="item",
        entity_id=item.id,
        entity_label=item.title,
        field="comment",
        new_value=_excerpt(payload.body),
    )
    db.commit()
    db.refresh(comment)
    return comment


@router.patch("/comments/{comment_id}", response_model=CommentRead)
def update_comment(
    comment_id: int,
    payload: CommentUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> Comment:
    comment = _comment_or_404(db, comment_id)
    if not _can_modify(current, comment):
        raise HTTPException(status_code=403, detail="Not your comment")
    old_body = comment.body
    comment.body = payload.body
    comment.updated_at = utcnow()
    item = db.get(Item, comment.item_id)
    log_event(
        db,
        actor=current,
        event_type="comment.edited",
        entity_type="item",
        entity_id=comment.item_id,
        entity_label=item.title if item else None,
        field="comment",
        old_value=_excerpt(old_body),
        new_value=_excerpt(payload.body),
    )
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> None:
    comment = _comment_or_404(db, comment_id)
    if not _can_modify(current, comment):
        raise HTTPException(status_code=403, detail="Not your comment")
    reply_count = len(comment.replies)
    item = db.get(Item, comment.item_id)
    old_value = _excerpt(comment.body) + (f" (+{reply_count} replies)" if reply_count else "")
    log_event(
        db,
        actor=current,
        event_type="comment.deleted",
        entity_type="item",
        entity_id=comment.item_id,
        entity_label=item.title if item else None,
        field="comment",
        old_value=old_value,
    )
    db.delete(comment)  # ORM delete-orphan removes replies
    db.commit()
```

- [ ] **Step 5: Register in `backend/app/main.py`**

Add `comments` to the `from app.routers import ...` line and `comments.router,` to the protected loop tuple.

- [ ] **Step 6: Run tests to verify they pass**

Run: `docker compose exec -T backend sh -c 'rm -rf /app/app /app/tests' && docker compose cp ./backend/app backend:/app/app && docker compose cp ./backend/tests backend:/app/tests && docker compose exec -T backend python -m pytest tests/test_api_comments.py -q`
Expected: PASS (7 passed). Then the full suite: `docker compose exec -T backend python -m pytest -q` — expect 145 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/comments.py backend/app/main.py backend/tests/test_api_comments.py
git commit -m "feat(backend): comments API with one-level replies, permissions, audit events"
```

---

### Task 3: Frontend — types/client + `useOptionalAuth` + `ItemComments`

**Files:**
- Modify: `frontend/src/types.ts` (append `Comment`)
- Modify: `frontend/src/api/client.ts` (four fns)
- Modify: `frontend/src/auth/AuthContext.tsx` (add `useOptionalAuth`)
- Create: `frontend/src/components/ItemComments.tsx`
- Test: `frontend/src/components/ItemComments.test.tsx`

**Interfaces:**
- Consumes: backend `CommentRead` shape (Task 2); `AuthProvider`/`AuthContext` (existing).
- Produces: `Comment` TS interface; `getComments(itemId)`, `createComment(itemId, payload)`, `updateComment(id, body)`, `deleteComment(id)`; `useOptionalAuth(): AuthValue | null`; `ItemComments({ itemId })`. Task 4 renders it.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ItemComments.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { AuthProvider } from "../auth/AuthContext";
import ItemComments from "./ItemComments";

afterEach(() => vi.restoreAllMocks());

const anna = { id: 1, email: "a@b.ch", display_name: "Anna", role: "member", is_active: true } as const;
const admin = { id: 9, email: "r@b.ch", display_name: "Root", role: "admin", is_active: true } as const;

const comment = (over: object = {}) => ({
  id: 1, item_id: 5, parent_id: null, author_id: 1, author_name: "Anna",
  body: "First!", created_at: "2026-07-02T10:00:00", updated_at: null,
  ...over,
});

function renderAs(user: typeof anna | typeof admin, comments: unknown[]) {
  vi.spyOn(client, "getMe").mockResolvedValue(user as never);
  vi.spyOn(client, "getComments").mockResolvedValue(comments as never);
  render(
    <AuthProvider>
      <ItemComments itemId={5} />
    </AuthProvider>,
  );
}

it("renders author, date, edited marker, and indented replies", async () => {
  renderAs(anna, [
    comment(),
    comment({ id: 2, parent_id: 1, author_id: 3, author_name: "Ben", body: "A reply", updated_at: "2026-07-02T11:00:00" }),
  ]);
  expect(await screen.findByText("First!")).toBeInTheDocument();
  expect(screen.getByText("Anna")).toBeInTheDocument();
  expect(screen.getByText("A reply")).toBeInTheDocument();
  expect(screen.getByText("Ben")).toBeInTheDocument();
  expect(screen.getByText("(edited)")).toBeInTheDocument();
});

it("posts a new comment and a reply with the right payloads", async () => {
  const create = vi.spyOn(client, "createComment").mockResolvedValue(comment() as never);
  renderAs(anna, [comment()]);
  await screen.findByText("First!");

  await userEvent.type(screen.getByPlaceholderText(/write a comment/i), "New thoughts");
  await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
  expect(create).toHaveBeenCalledWith(5, { body: "New thoughts" });

  await userEvent.click(screen.getByRole("button", { name: /^reply$/i }));
  await userEvent.type(screen.getByPlaceholderText(/write a reply/i), "Me too");
  await userEvent.click(screen.getByRole("button", { name: /post reply/i }));
  expect(create).toHaveBeenCalledWith(5, { body: "Me too", parent_id: 1 });
});

it("edits own comment inline", async () => {
  const update = vi.spyOn(client, "updateComment").mockResolvedValue(comment({ body: "v2" }) as never);
  renderAs(anna, [comment()]);
  await screen.findByText("First!");
  await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
  const box = screen.getByDisplayValue("First!");
  await userEvent.clear(box);
  await userEvent.type(box, "v2");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(update).toHaveBeenCalledWith(1, "v2");
});

it("hides Edit/Delete on others' comments for members, shows them for admins", async () => {
  renderAs(anna, [comment({ id: 3, author_id: 42, author_name: "Zoe" })]);
  await screen.findByText("First!");
  expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  vi.restoreAllMocks();
  renderAs(admin, [comment({ id: 3, author_id: 42, author_name: "Zoe" })]);
  expect((await screen.findAllByRole("button", { name: /^edit$/i })).length).toBe(1);
});

it("confirms before deleting a comment that has replies", async () => {
  const del = vi.spyOn(client, "deleteComment").mockResolvedValue(undefined as never);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  renderAs(anna, [comment(), comment({ id: 2, parent_id: 1, author_id: 1, body: "r" })]);
  await screen.findByText("First!");
  await userEvent.click(screen.getAllByRole("button", { name: /^delete$/i })[0]);
  expect(confirm).toHaveBeenCalledWith("Delete this comment and its replies?");
  expect(del).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ItemComments.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Types, client, `useOptionalAuth`**

`frontend/src/types.ts` — append:

```ts
export interface Comment {
  id: number;
  item_id: number;
  parent_id: number | null;
  author_id: number;
  author_name: string | null;
  body: string;
  created_at: string;
  updated_at: string | null;
}
```

`frontend/src/api/client.ts` — add `Comment` to the type import block; append:

```ts
export function getComments(itemId: number): Promise<Comment[]> {
  return request<Comment[]>(`/api/items/${itemId}/comments`);
}

export function createComment(
  itemId: number,
  payload: { body: string; parent_id?: number | null },
): Promise<Comment> {
  return request<Comment>(`/api/items/${itemId}/comments`, json(payload));
}

export function updateComment(id: number, body: string): Promise<Comment> {
  return request<Comment>(`/api/comments/${id}`, { ...json({ body }), method: "PATCH" });
}

export function deleteComment(id: number): Promise<void> {
  return request<void>(`/api/comments/${id}`, { method: "DELETE" });
}
```

`frontend/src/auth/AuthContext.tsx` — append below `useAuth`:

```tsx
/** Like useAuth, but returns null outside the provider (bare component tests,
 *  or contexts where auth is optional). */
export function useOptionalAuth(): AuthValue | null {
  return useContext(AuthContext);
}
```

- [ ] **Step 4: Create `frontend/src/components/ItemComments.tsx`**

```tsx
import { useEffect, useState } from "react";
import { createComment, deleteComment, getComments, updateComment } from "../api/client";
import { useOptionalAuth } from "../auth/AuthContext";
import type { AuthUser, Comment } from "../types";

const box =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100";
const action =
  "text-xs font-medium text-gray-400 transition hover:text-gray-700";

function canModify(user: AuthUser | null, comment: Comment): boolean {
  return !!user && (user.role === "admin" || user.id === comment.author_id);
}

function Header({ comment }: { comment: Comment }) {
  return (
    <div className="text-xs text-gray-500">
      <span className="font-medium text-gray-700">{comment.author_name ?? "Unknown"}</span>
      <span className="text-gray-400"> · {new Date(comment.created_at).toLocaleString()}</span>
      {comment.updated_at && <span className="text-gray-400"> (edited)</span>}
    </div>
  );
}

export default function ItemComments({ itemId }: { itemId: number }) {
  const user = useOptionalAuth()?.user ?? null;
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () =>
    getComments(itemId)
      .then(setComments)
      .catch(() => setComments([]));

  useEffect(() => {
    let stale = false;
    setComments([]);
    getComments(itemId)
      .then((rows) => {
        if (!stale) setComments(rows);
      })
      .catch(() => {
        if (!stale) setComments([]);
      });
    return () => {
      stale = true;
    };
  }, [itemId]);

  const post = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await createComment(itemId, { body: draft.trim() });
      setDraft("");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const postReply = async (parentId: number) => {
    if (!replyDraft.trim() || busy) return;
    setBusy(true);
    try {
      await createComment(itemId, { body: replyDraft.trim(), parent_id: parentId });
      setReplyDraft("");
      setReplyTo(null);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: number) => {
    if (!editDraft.trim() || busy) return;
    setBusy(true);
    try {
      await updateComment(id, editDraft.trim());
      setEditingId(null);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (comment: Comment, replyCount: number) => {
    if (replyCount > 0 && !window.confirm("Delete this comment and its replies?")) return;
    await deleteComment(comment.id);
    await reload();
  };

  const topLevel = comments.filter((c) => c.parent_id === null);
  const repliesOf = (id: number) => comments.filter((c) => c.parent_id === id);

  const renderBody = (comment: Comment) =>
    editingId === comment.id ? (
      <div className="mt-1 flex flex-col gap-1.5">
        <textarea
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          rows={2}
          className={box}
        />
        <div className="flex gap-2">
          <button onClick={() => void saveEdit(comment.id)} className={action}>
            Save
          </button>
          <button onClick={() => setEditingId(null)} className={action}>
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <p className="whitespace-pre-wrap text-sm text-gray-800">{comment.body}</p>
    );

  const renderActions = (comment: Comment, isReply: boolean) => (
    <div className="mt-0.5 flex gap-3">
      {!isReply && user && (
        <button
          onClick={() => {
            setReplyTo(replyTo === comment.id ? null : comment.id);
            setReplyDraft("");
          }}
          className={action}
        >
          Reply
        </button>
      )}
      {canModify(user, comment) && editingId !== comment.id && (
        <>
          <button
            onClick={() => {
              setEditingId(comment.id);
              setEditDraft(comment.body);
            }}
            className={action}
          >
            Edit
          </button>
          <button
            onClick={() => void remove(comment, isReply ? 0 : repliesOf(comment.id).length)}
            className={`${action} hover:text-red-600`}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {user && (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a comment…"
            rows={2}
            className={box}
          />
          <button
            onClick={() => void post()}
            disabled={!draft.trim() || busy}
            className="self-end rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            Post
          </button>
        </div>
      )}

      {topLevel.length === 0 && <p className="text-xs text-gray-400">No comments yet.</p>}

      <ul className="flex flex-col gap-3">
        {topLevel.map((comment) => (
          <li key={comment.id}>
            <Header comment={comment} />
            {renderBody(comment)}
            {renderActions(comment, false)}

            {repliesOf(comment.id).length > 0 && (
              <ul className="ml-4 mt-2 flex flex-col gap-2 border-l border-gray-200 pl-3">
                {repliesOf(comment.id).map((reply) => (
                  <li key={reply.id}>
                    <Header comment={reply} />
                    {renderBody(reply)}
                    {renderActions(reply, true)}
                  </li>
                ))}
              </ul>
            )}

            {replyTo === comment.id && (
              <div className="ml-4 mt-2 flex flex-col gap-1.5 border-l border-gray-200 pl-3">
                <textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  placeholder="Write a reply…"
                  rows={2}
                  className={box}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => void postReply(comment.id)}
                    disabled={!replyDraft.trim() || busy}
                    className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    Post reply
                  </button>
                  <button onClick={() => setReplyTo(null)} className={action}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Run tests + type-check**

Run: `cd frontend && npx vitest run src/components/ItemComments.test.tsx && npx tsc --noEmit`
Expected: PASS (5 passed) and clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/auth/AuthContext.tsx frontend/src/components/ItemComments.tsx frontend/src/components/ItemComments.test.tsx
git commit -m "feat(frontend): ItemComments with replies, inline edit, permission-gated actions"
```

---

### Task 4: Drawer wiring + `ItemActivity` comment phrases

**Files:**
- Modify: `frontend/src/components/ItemDrawer.tsx` (Comments section before Activity)
- Modify: `frontend/src/components/ItemActivity.tsx` (three `describe()` cases)
- Test: `frontend/src/components/ItemActivity.test.tsx` (append one test)

**Interfaces:**
- Consumes: `ItemComments` (Task 3).

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/ItemActivity.test.tsx` (uses the existing `ev` helper):

```tsx
it("phrases comment events", async () => {
  vi.spyOn(client, "getItemEvents").mockResolvedValue([
    ev({ id: 6, event_type: "comment.deleted", field: "comment", old_value: "bye", new_value: null }),
    ev({ id: 5, event_type: "comment.edited", field: "comment", old_value: "a", new_value: "b" }),
    ev({ id: 4, event_type: "comment.added", field: "comment", old_value: null, new_value: "Hello there" }),
  ] as never);
  render(<ItemActivity itemId={5} />);
  expect(await screen.findByText("commented: Hello there")).toBeInTheDocument();
  expect(screen.getByText("edited a comment")).toBeInTheDocument();
  expect(screen.getByText("deleted a comment")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ItemActivity.test.tsx`
Expected: FAIL — the new test finds raw `comment.added` instead of the phrase.

- [ ] **Step 3: Implement**

`frontend/src/components/ItemActivity.tsx` — add to the `describe()` switch before `default`:

```tsx
    case "comment.added":
      return `commented: ${event.new_value ?? ""}`;
    case "comment.edited":
      return "edited a comment";
    case "comment.deleted":
      return "deleted a comment";
```

`frontend/src/components/ItemDrawer.tsx` — add `import ItemComments from "./ItemComments";` beside the other component imports, and insert directly BEFORE the existing `<Section label="Activity">`:

```tsx
        <Section label="Comments">
          <ItemComments itemId={item.id} />
        </Section>
```

- [ ] **Step 4: Run the full frontend suite + type-check**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: ALL pass (167 = 161 + 5 ItemComments + 1 ItemActivity), tsc clean. The 5 pre-existing drawer test files pass UNMODIFIED (`useOptionalAuth` returns null without a provider → read-only render; fetch errors degrade).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ItemDrawer.tsx frontend/src/components/ItemActivity.tsx frontend/src/components/ItemActivity.test.tsx
git commit -m "feat(frontend): Comments section in the drawer + activity phrases"
```

---

### Task 5: Deploy + end-to-end smoke

**Files:** none (deploy + verification only)

- [ ] **Step 1: Rebuild + migrate**

```bash
docker compose up -d --build backend frontend
docker compose exec -T backend alembic current   # expect: 0011 (head)
```

(Fallback if the frontend image build hits Docker Hub `DeadlineExceeded`: `cd frontend && npm run build && cd .. && docker compose exec -T frontend sh -c 'rm -rf /usr/share/nginx/html/*' && docker compose cp frontend/dist/. frontend:/usr/share/nginx/html/`.)

- [ ] **Step 2: Curl smoke through nginx**

```bash
curl -s -c /tmp/cm-cookies -X POST localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"admin"}' -o /dev/null -w "login: %{http_code}\n"
ITEM=$(curl -s -b /tmp/cm-cookies localhost:8080/api/items | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
C1=$(curl -s -b /tmp/cm-cookies -X POST localhost:8080/api/items/$ITEM/comments \
  -H 'Content-Type: application/json' -d '{"body":"Smoke comment"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['id'])")
curl -s -b /tmp/cm-cookies -X POST localhost:8080/api/items/$ITEM/comments \
  -H 'Content-Type: application/json' -d "{\"body\":\"Smoke reply\",\"parent_id\":$C1}" -o /dev/null -w "reply: %{http_code}\n"
curl -s -b /tmp/cm-cookies localhost:8080/api/items/$ITEM/comments | python3 -c "import sys,json; rows=json.load(sys.stdin); print('comments:', [(r['body'], r['parent_id'], r['author_name']) for r in rows])"
curl -s -b /tmp/cm-cookies -X PATCH localhost:8080/api/comments/$C1 \
  -H 'Content-Type: application/json' -d '{"body":"Smoke comment (fixed)"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('edited, updated_at set:', d['updated_at'] is not None)"
curl -s -b /tmp/cm-cookies "localhost:8080/api/audit?q=comment" | python3 -c "import sys,json; d=json.load(sys.stdin); print('comment audit events:', d['total'])"
rm -f /tmp/cm-cookies
```

Expected: login 200, reply 201, list shows both rows with author names + threading, edit sets `updated_at`, audit total ≥ 2 (`comment.added` + `comment.edited`).

- [ ] **Step 3: Browser check** (controller, via Playwright): drawer shows the Comments section between Links and Activity — composer posts, reply indents under the parent with author · date, edit shows "(edited)", the Activity section phrases the comment events.

- [ ] **Step 4: Commit** — nothing to commit unless smoke revealed fixes.

---

## Self-Review Notes

- **Spec coverage:** model/cascades/migration (T1); API with one-level rule, permission matrix, body bounds, ordering, audit events with excerpts and `(+N replies)` (T2); types/client/`useOptionalAuth`/component with composer, reply, inline edit, delete-confirm, permission gating, stale-guard + error-degrade (T3); drawer placement + activity phrases (T4); deploy/smoke (T5). Scope guards are omissions.
- **Type consistency:** `CommentRead` (T2) = `Comment` TS interface (T3); `createComment(itemId, {body, parent_id?})` matches the component's calls and the test payload assertions (`{body}` without `parent_id` for top-level — note `parent_id` is omitted, not null, in the top-level call so the test asserts `{ body: "New thoughts" }`); `useOptionalAuth` consumed only by `ItemComments`.
- **Fixture discipline:** permission tests use `anon_client` + local `_as()` overrides (never mixed with `member_client` in one test); the one `member_client` test stands alone.
- **Count math:** backend 136 → T1 +2 = 138 → T2 +7 = 145. Frontend 161 → T3 +5 = 166 → T4 +1 = 167.
- **Known trade-offs:** `reload()` after each mutation refetches the flat list (cheap; keeps threading consistent); `busy` is a single flag shared across composer/reply/edit (one in-flight mutation at a time — acceptable for a drawer-sized UI); comments cascaded by item deletion are covered by `item.deleted` in the audit log (no per-comment events), consistent with the import philosophy.
