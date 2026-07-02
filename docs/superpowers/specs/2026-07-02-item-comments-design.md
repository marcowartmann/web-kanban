# Item Comments & Replies — Design

**Date:** 2026-07-02
**Status:** Approved (design); pending spec review

## Goal

Items (features, stories, risks) get a conversation: top-level **comments**,
each with **0..n replies** (exactly one level — replies cannot be replied to).
Every comment and reply shows its **author and date**. Authors can **edit**
(with an "(edited)" marker) and **delete** their own; **admins** can edit or
delete anything. All comment activity is recorded in the **audit log**.

## Data model (migration `0011_comments`, `down_revision = "0010"`)

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
        cascade="all, delete-orphan"
    )

    @property
    def author_name(self) -> str | None:
        return self.author.display_name if self.author else None
```

- `item_id` CASCADE: deleting an item deletes its conversation (comments are
  content, unlike audit rows which deliberately survive).
- `parent_id` CASCADE + the ORM `replies` relationship (`delete-orphan`,
  mirroring `Item.children`): deleting a comment deletes its replies — real
  in both Postgres and the SQLite test fixtures.
- `author_id` plain FK: users are deactivate-only (never hard-deleted), so
  the reference is stable; `author_name` resolves via the relationship
  property exactly like `User.team_name`.
- Additionally, `Item` gains
  `comments: Mapped[list["Comment"]] = relationship(cascade="all, delete-orphan")`
  so item deletion cascades in tests too.
- Migration creates the table + indexes `ix_comments_item_id`,
  `ix_comments_parent_id`, `ix_comments_author_id`.

## Schemas

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

## API — `backend/app/routers/comments.py`

New router, prefix `/api`, registered in `main.py`'s protected loop (all
endpoints require an authenticated user; members and admins alike may
comment).

- `GET /api/items/{item_id}/comments` → **flat** `list[CommentRead]`,
  `ORDER BY created_at ASC, id ASC` (conversation order; the frontend groups
  replies under parents by `parent_id`). 404 when the item doesn't exist.
- `POST /api/items/{item_id}/comments` (`CommentCreate`) → 201.
  Validations: item exists (404); when `parent_id` is set: the parent must
  exist (422 `"parent_id does not exist"`), must belong to the same item
  (422 `"parent belongs to a different item"`), and must be top-level
  (422 `"replies cannot be nested"`). `author_id` = the session user.
- `PATCH /api/comments/{comment_id}` (`CommentUpdate`) → 200.
  **Author or admin** only, else 403 `"Not your comment"`. Sets
  `updated_at` to now (naive UTC via the existing `utcnow()` helper).
  404 unknown comment.
- `DELETE /api/comments/{comment_id}` → 204. **Author or admin** only,
  else 403. Replies are removed with the parent. 404 unknown comment.

A single permission helper in the router:

```python
def _can_modify(user: User, comment: Comment) -> bool:
    return user.role == "admin" or comment.author_id == user.id
```

## Audit integration

Three new catalog events, all `entity_type="item"` (so they appear in the
item's drawer Activity AND the admin Audit Log), `entity_id` = the item,
`entity_label` = the item title, `field="comment"`, logged via the existing
`log_event` and riding each endpoint's single commit:

| event | old_value | new_value |
|---|---|---|
| `comment.added` | — | body excerpt |
| `comment.edited` | old-body excerpt | new-body excerpt |
| `comment.deleted` | excerpt, plus `" (+N replies)"` when N > 0 replies were cascaded | — |

Excerpt = first 120 characters of the body, with `"…"` appended when
truncated (helper `_excerpt(body)` in the comments router). `log_event`'s
existing truncation guards still apply.

`ItemActivity.describe()` gains three cases:
`comment.added` → `commented: <new_value>`;
`comment.edited` → `edited a comment`;
`comment.deleted` → `deleted a comment`.

## Frontend

**Types/client:**

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

`getComments(itemId): Promise<Comment[]>`;
`createComment(itemId, payload: { body: string; parent_id?: number | null }): Promise<Comment>`;
`updateComment(id, body: string): Promise<Comment>`;
`deleteComment(id): Promise<void>`.

**`components/ItemComments.tsx`** — rendered by `ItemDrawer` as a new
section **between Links and Activity**, label `Comments · ${count}` (count =
total incl. replies):

- Composer on top: textarea (placeholder `Write a comment…`) + `Post`
  button (disabled while empty/whitespace or in flight). Posting clears the
  box and reloads the list.
- Top-level comments in conversation order; each renders:
  - header: `author_name ?? "Unknown"` (font-medium) `·`
    `toLocaleString()` date, plus a muted `(edited)` when `updated_at` set;
  - body in `whitespace-pre-wrap` text-sm;
  - actions row: `Reply` (always), `Edit` + `Delete` only when
    `user.id === author_id || user.role === "admin"` (via `useAuth`; server
    enforces regardless).
- `Reply` opens an inline composer under the comment (textarea + `Reply` /
  `Cancel`); replies render indented (`ml-4 border-l pl-3`) under their
  parent, oldest-first, with the same header/actions (minus Reply — one
  level only).
- `Edit` swaps the body for an inline textarea + `Save`/`Cancel`.
- `Delete` calls `window.confirm("Delete this comment and its replies?")`
  ONLY when the comment has replies; otherwise deletes immediately.
- Like `ItemActivity`: fetch on mount/`itemId` change with a stale-response
  guard, and errors degrade to the empty list (`No comments yet.`) so the
  pre-existing drawer test files keep passing unmodified.

## Testing

**Backend:** model roundtrip + author_name property; ORM cascades (item
delete removes comments; comment delete removes replies); POST/GET flow with
threading order; reply validations (nested → 422, cross-item parent → 422,
missing parent → 422); PATCH by author 200 + `updated_at` set, by another
member 403, by admin 200; DELETE by author/admin + cascade; the three audit
events with excerpts (long body → 120-char + `…`; thread delete → `(+N
replies)`); member permissions (any member can comment).

**Frontend:** client fns hit the right URLs/methods; ItemComments renders
author/date/edited marker and indented replies; posting calls
`createComment` with the body (and `parent_id` for replies); edit flow calls
`updateComment`; delete with replies confirms first; Edit/Delete hidden on
others' comments for members, visible for admins; empty state + error
degrade.

## Scope guards (v1)

- No @mentions, no markdown (plain text, whitespace preserved), no
  attachments, no reactions, no notifications.
- No comment counts on board cards.
- The Activity section does not live-refresh when you comment (refetches on
  drawer reopen, as today).
- Deleted comments leave no tombstone in the thread (the audit log carries
  the record).
