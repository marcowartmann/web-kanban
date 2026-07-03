# Merge Team Members into Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One person entity: `User`. `team_members` disappears; login-less people are users with NULL email; `items.assignee` (string) becomes `assignee_id` FK; capacities re-key to `user_id`.

**Architecture:** Backend lands first in green stages (users-as-people API → items FK → capacities re-key + member deletion → the single data migration 0015 → snapshot repair), then frontend (types/client → drawer/App → planning/capacity → admin person manager), then deploy with a pre-migration JSON dump. `ItemRead.assignee` survives as the joined display name so read paths and the client-side Person filter stay untouched.

**Tech Stack:** Alembic data migration (PG-only `RETURNING`), SQLAlchemy 2.0, FastAPI, React 18 + TS, pytest/vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-merge-members-into-users-design.md`

## Global Constraints

- Branch: `feat/merge-members-into-users` off main (be53f88).
- Exact strings (em dash U+2014 where shown):
  - 422 `"Password requires an email"`; 422 `"Remove the password first"`; 422 `"Admins cannot delete themselves"`; 422 `"assignee_id does not exist"`; 422 `"user_id does not exist"`
  - 409 `"User '<display_name>' has <n> comments — deactivate instead"` (delete, NO force)
  - 409 `"User '<display_name>' is assigned to <n> items"` (delete, force allowed)
  - Restore warnings: `f"Cleared assignee for {n} item(s) whose user no longer exists"`; `"Legacy snapshot: assignee names were not restored"`
- Merge rules (migration AND import share them): exact `display_name == name` match, ties → lowest user id; merged users inherit member `team_id` only when theirs is NULL; unmatched names → login-less user (`email NULL, password NULL, role 'member', is_active true, auth_provider 'local'`).
- Audit: item assignee changes log `field="assignee"` with old/new display names; `user.deleted` label = email or display_name; capacity label `f"{display_name} · {pi} · I{iteration}"`.
- Item.assignee_id: FK users `ON DELETE SET NULL`, index `ix_items_assignee_id`; list endpoint uses `selectinload(Item.assignee_user)`.
- `/api/v1/users/options` (require_user) declared BEFORE `/{user_id}` routes; all other users endpoints keep admin-only via per-endpoint deps.
- Suite math: backend 202 → 209 (T1) → 215 (T2) → 210 (T3) → 210 (T4) → 212 (T5); frontend 192 → 194 (T6) → 195 (T7) → 195 (T8) → 197 (T9). T10 changes no counts.
- Migration 0015 `down_revision = "0014"`: MUST dry-run upgrade + downgrade + re-upgrade against compose Postgres AND run the seeded rehearsal (Task 4) before acceptance. DB left at 0015.
- ENV (backend tasks), from repo root — the container does NOT bind-mount code:
  ```bash
  docker compose exec -T backend sh -c 'rm -rf /app/app /app/alembic /app/tests'
  docker compose cp ./backend/app backend:/app/app
  docker compose cp ./backend/alembic backend:/app/alembic
  docker compose cp ./backend/tests backend:/app/tests
  docker compose exec -T backend python -m pytest -q /app/tests
  ```
  Frontend on host from `frontend/`: `npx vitest run`, `npx tsc --noEmit`.

---

### Task 1: Users as people (nullable email, person creation, delete guards, options)

**Files:**
- Modify: `backend/app/models.py` (User.email), `backend/app/schemas.py` (UserRead/UserCreate/UserUpdate), `backend/app/routers/users.py`
- Test: `backend/tests/test_users_people.py` (new, 8 tests)

**Interfaces:**
- Produces: `GET /api/v1/users/options` → `[{id, display_name}]` (require_user); `DELETE /api/v1/users/{id}?force=` with guards; person-only `POST /users` (no email/password).

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_users_people.py`:

```python
from app.models import Comment, Item, ItemKind, User


def _person(client, name, **extra):
    resp = client.post("/api/v1/users", json={"display_name": name, **extra})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_person_only_creation(client):
    body = _person(client, "No Login")
    assert body["email"] is None
    assert body["role"] == "member"
    listed = client.get("/api/v1/users").json()
    assert any(u["display_name"] == "No Login" and u["email"] is None for u in listed)


def test_password_requires_email(client):
    resp = client.post(
        "/api/v1/users", json={"display_name": "P", "password": "secret123"}
    )
    assert resp.status_code == 422
    assert "Password requires an email" in resp.text


def test_email_clear_rules(client):
    person = _person(client, "Clearable", email="clear@x.local")
    resp = client.patch(f"/api/v1/users/{person['id']}", json={"email": None})
    assert resp.status_code == 200
    assert resp.json()["email"] is None

    full = _person(client, "Locked", email="locked@x.local", password="secret123")
    resp = client.patch(f"/api/v1/users/{full['id']}", json={"email": None})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Remove the password first"


def test_delete_self_is_422(client):
    me = client.get("/api/v1/auth/me").json()
    resp = client.delete(f"/api/v1/users/{me['id']}")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Admins cannot delete themselves"


def test_delete_with_comments_409_no_force(client, db_session):
    person = _person(client, "Author P", email="author@x.local")
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "C"}).json()
    db_session.add(
        Comment(item_id=item["id"], author_id=person["id"], body="kept history")
    )
    db_session.commit()
    for qs in ("", "?force=true"):
        resp = client.delete(f"/api/v1/users/{person['id']}{qs}")
        assert resp.status_code == 409
        assert resp.json()["detail"] == "User 'Author P' has 1 comments — deactivate instead"


def test_delete_assigned_409_then_force_nulls(client, db_session):
    person = _person(client, "Assigned P")
    item = Item(kind=ItemKind.FEATURE, title="A", position=0, assignee_id=person["id"])
    db_session.add(item)
    db_session.commit()
    resp = client.delete(f"/api/v1/users/{person['id']}")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "User 'Assigned P' is assigned to 1 items"
    assert client.delete(f"/api/v1/users/{person['id']}?force=true").status_code == 204
    db_session.expire_all()
    assert db_session.get(Item, item.id).assignee_id is None
    assert db_session.get(User, person["id"]) is None


def test_delete_is_audited(client, db_session):
    from app.models import AuditEvent

    person = _person(client, "Bye P")
    assert client.delete(f"/api/v1/users/{person['id']}").status_code == 204
    row = db_session.query(AuditEvent).filter_by(event_type="user.deleted").one()
    assert row.entity_label == "Bye P"


def test_options_is_member_accessible(client, member_client):
    _person(client, "Zeta")
    _person(client, "Alpha")
    resp = member_client.get("/api/v1/users/options")
    assert resp.status_code == 200
    names = [o["display_name"] for o in resp.json()]
    assert names == sorted(names)
    assert set(resp.json()[0]) == {"id", "display_name"}
    assert member_client.get("/api/v1/users").status_code == 403
```

NOTE (binding): `test_delete_assigned_409_then_force_nulls` needs `Item.assignee_id`,
which Task 2 adds — Task 1 ships the file WITHOUT it (7 tests, suite 209) plus a
`# Task 2 appends test_delete_assigned_409_then_force_nulls` marker comment; Task 2
appends it verbatim. Task 1's `delete_user` uses the transitional string-column check
described in Step 5 so the guard logic itself ships now.

- [ ] **Step 2: Run — expect failures** (person creation 422 on missing email/password; options 404; delete 405).

- [ ] **Step 3: Model** — `backend/app/models.py` User.email becomes:

```python
    email: Mapped[str | None] = mapped_column(String(255), unique=True)  # lowercase; NULL = cannot log in
```

- [ ] **Step 4: Schemas** — in `backend/app/schemas.py`:
  - `UserRead.email: str | None`
  - `UserCreate` becomes:

```python
class UserCreate(BaseModel):
    email: str | None = Field(default=None, min_length=3, max_length=255)
    display_name: str = Field(min_length=1, max_length=120)
    password: str | None = Field(default=None, min_length=8, max_length=72)
    role: Literal["admin", "member"] = "member"
    team_id: int | None = None

    _check_password = field_validator("password")(_password_fits_bcrypt)
```

  (`_password_fits_bcrypt` must tolerate None — read it; if it does not, guard with
  `if value is None: return value` inside the existing validator.)

- [ ] **Step 5: Router** — `backend/app/routers/users.py`:
  - Router loses `dependencies=[Depends(require_admin)]`; add
    `admin = Depends(require_admin)` per existing endpoint (list/create/patch — they
    already take `current: User = Depends(require_admin)` or gain
    `dependencies=[Depends(require_admin)]` on the decorator; keep the existing
    `current` params).
  - Add BEFORE any `/{user_id}` route:

```python
from app.auth import hash_password, require_admin, require_user
from app.schemas import PersonOption, UserCreate, UserRead, UserUpdate


@router.get("/options", response_model=list[PersonOption])
def user_options(
    db: Session = Depends(get_db), current: User = Depends(require_user)
) -> list[User]:
    return list(db.scalars(select(User).order_by(User.display_name)))
```

    with `PersonOption` in schemas.py (after UserRead):

```python
class PersonOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    display_name: str
```

  - `create_user`: email/password optionality:

```python
    email = payload.email.strip().lower() if payload.email else None
    if payload.password is not None and email is None:
        raise HTTPException(status_code=422, detail="Password requires an email")
    if email and db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status_code=409, detail="Email already in use")
    ...
    user = User(
        email=email,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password) if payload.password else None,
        role=payload.role,
        team_id=payload.team_id,
    )
    ...
    entity_label=user.email or user.display_name,
```

  - `update_user` email handling — explicit null clears when passwordless:

```python
    if "email" in changes:
        email = changes.pop("email")
        if email is None:
            if user.password_hash is not None:
                raise HTTPException(status_code=422, detail="Remove the password first")
            user.email = None
        else:
            email = email.strip().lower()
            if db.scalar(
                select(User).where(func.lower(User.email) == email, User.id != user.id)
            ):
                raise HTTPException(status_code=409, detail="Email already in use")
            user.email = email
```

    (audit `entity_label=user.email or user.display_name` everywhere in the file).
  - New DELETE endpoint (after update_user):

```python
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
```

    **Task-1 transitional note (binding):** `Item.assignee_id` does not exist until
    Task 2 — in Task 1 the `assigned` check is
    `db.scalar(select(func.count()).select_from(Item).where(Item.assignee == user.display_name))`
    (the current string column); Task 2 swaps it to `Item.assignee_id == user.id`.
    Sessions cascade via the existing FK; capacities cascade arrives with Task 3.

- [ ] **Step 6: Full backend suite — expect 209 passed** (202 + 7). Existing
  `test_api_users.py` must stay green (create payloads there include email+password —
  unaffected).
- [ ] **Step 7: Commit** — `git add backend && git commit -m "feat(backend): users as people — nullable email, person creation, delete guards, options"`

---

### Task 2: Items assignee FK

**Files:**
- Modify: `backend/app/models.py` (Item), `backend/app/schemas.py` (ItemBase/ItemUpdate/ItemRead), `backend/app/routers/items.py`, `backend/app/audit.py`, `backend/app/csv_import.py`, `backend/app/routers/team_members.py` (strip propagation + guard), `backend/tests/test_users_people.py` (append the 8th test), `backend/tests/test_api_renames.py` (drop 2 member tests), `backend/tests/test_schema_hygiene.py` (index name), `backend/tests/test_import_endpoint.py` (+1 test)
- Test: `backend/tests/test_item_assignee.py` (new, 6 tests)

**Interfaces:**
- Consumes: Task 1's login-less users. Produces: `Item.assignee_id` + `Item.assignee` property; `ItemCreate/ItemUpdate.assignee_id`; list filter `assignee_id`; import resolves names → users.

- [ ] **Step 1: Failing tests** — create `backend/tests/test_item_assignee.py`:

```python
from app.models import AuditEvent, Item, User


def _person(client, name):
    return client.post("/api/v1/users", json={"display_name": name}).json()


def test_create_with_assignee_id_serves_display_name(client):
    p = _person(client, "Worker")
    body = client.post(
        "/api/v1/items",
        json={"kind": "feature", "title": "F", "assignee_id": p["id"]},
    ).json()
    assert body["assignee_id"] == p["id"]
    assert body["assignee"] == "Worker"
    page = client.get("/api/v1/items").json()
    row = next(i for i in page["items"] if i["id"] == body["id"])
    assert row["assignee"] == "Worker" and row["assignee_id"] == p["id"]


def test_unknown_assignee_id_is_422(client):
    resp = client.post(
        "/api/v1/items", json={"kind": "feature", "title": "F", "assignee_id": 99999}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "assignee_id does not exist"
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "G"}).json()
    resp = client.patch(
        f"/api/v1/items/{item['id']}", json={"assignee_id": 99999, "version": 1}
    )
    assert resp.status_code == 422


def test_patch_set_and_clear_assignee(client):
    p = _person(client, "Setter")
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "S"}).json()
    setr = client.patch(
        f"/api/v1/items/{item['id']}", json={"assignee_id": p["id"], "version": 1}
    ).json()
    assert setr["assignee"] == "Setter"
    cleared = client.patch(
        f"/api/v1/items/{item['id']}", json={"assignee_id": None, "version": 2}
    ).json()
    assert cleared["assignee"] is None and cleared["assignee_id"] is None


def test_list_filter_by_assignee_id(client):
    p = _person(client, "Filter P")
    client.post("/api/v1/items", json={"kind": "feature", "title": "Mine", "assignee_id": p["id"]})
    client.post("/api/v1/items", json={"kind": "feature", "title": "Other"})
    page = client.get(f"/api/v1/items?assignee_id={p['id']}").json()
    assert [i["title"] for i in page["items"]] == ["Mine"]


def test_assignee_audit_logs_names(client, db_session):
    a = _person(client, "Alice")
    b = _person(client, "Bob")
    item = client.post(
        "/api/v1/items", json={"kind": "feature", "title": "T", "assignee_id": a["id"]}
    ).json()
    client.patch(f"/api/v1/items/{item['id']}", json={"assignee_id": b["id"], "version": 1})
    client.patch(f"/api/v1/items/{item['id']}", json={"assignee_id": None, "version": 2})
    rows = [
        (e.old_value, e.new_value)
        for e in db_session.query(AuditEvent)
        .filter_by(event_type="item.updated", field="assignee")
        .order_by(AuditEvent.id)
    ]
    assert rows == [("Alice", "Bob"), ("Bob", None)]


def test_old_string_assignee_patch_is_rejected(client):
    # ItemUpdate is extra="forbid"; the removed string field must 422 on PATCH.
    # (ItemCreate is not forbid — unknown keys there are ignored, existing behavior.)
    item = client.post("/api/v1/items", json={"kind": "feature", "title": "F"}).json()
    resp = client.patch(
        f"/api/v1/items/{item['id']}", json={"assignee": "Ghost", "version": 1}
    )
    assert resp.status_code == 422
```

  Append to `backend/tests/test_users_people.py` the deferred
  `test_delete_assigned_409_then_force_nulls` exactly as printed in Task 1 Step 1.

- [ ] **Step 2: Run — expect FAIL** (unknown `assignee_id` field via extra="forbid"… ItemBase is not forbid — create accepts and crashes on Item(**...); exact failure mode may vary; what matters is the new file fails and nothing silently passes).

- [ ] **Step 3: Model** — `backend/app/models.py` Item: delete the
  `assignee: Mapped[str | None] ...` column line; after `supporting_team` add:

```python
    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
```

  and after the `comments` relationship add:

```python
    assignee_user: Mapped["User | None"] = relationship(foreign_keys=[assignee_id])

    @property
    def assignee(self) -> str | None:
        return self.assignee_user.display_name if self.assignee_user else None
```

- [ ] **Step 4: Schemas** — `ItemBase`: replace `assignee: str | None = None` with
  `assignee_id: int | None = None`; `ItemRead` additionally declares
  `assignee: str | None = None` (populated from the property via from_attributes);
  `ItemUpdate`: replace `assignee: str | None = None` with `assignee_id: int | None = None`.

- [ ] **Step 5: Router** — `backend/app/routers/items.py`:
  - list_items: param `assignee: str | None = None` → `assignee_id: int | None = None`;
    where-clause `Item.assignee == assignee` → `Item.assignee_id == assignee_id`; add
    `.options(selectinload(Item.assignee_user))` to the rows select (import
    `selectinload` from sqlalchemy.orm).
  - Shared validator used by create and update:

```python
def _check_assignee(db: Session, assignee_id: int | None) -> None:
    if assignee_id is not None and db.get(User, assignee_id) is None:
        raise HTTPException(status_code=422, detail="assignee_id does not exist")
```

    called in `create_item` (before `Item(**payload.model_dump())`) and in
    `update_item` when `"assignee_id" in changes`.
  - Audit-by-name in `update_item`: `before` snapshot resolves names —

```python
    changes = payload.model_dump(exclude_unset=True)
    changes.pop("version", None)
    if "assignee_id" in changes:
        _check_assignee(db, changes["assignee_id"])
    before = {f: getattr(item, f) for f in changes if f in ITEM_TRACKED_FIELDS}
    if "assignee_id" in changes:
        before["assignee"] = item.assignee
    for key, value in changes.items():
        setattr(item, key, value)
    if _WSJF_FIELDS & changes.keys():
        recompute(item)
    if "assignee_id" in changes:
        db.flush()
        db.refresh(item, ["assignee_user"])
        changes = dict(changes)
        changes["assignee"] = item.assignee
        changes.pop("assignee_id")
```

(the `_WSJF_FIELDS` recompute line is the EXISTING line — it stays exactly where it
is today, between the setattr loop and the new assignee-name resolution block)

    (then the existing `diff_item_changes(before, changes)` loop logs
    `field="assignee"` with names.) In `audit.py` ITEM_TRACKED_FIELDS keep the literal
    `"assignee"` entry (names flow through it) — no change needed there beyond
    verifying `"assignee_id"` is NOT added.
  - `delete_user`'s Task-1 transitional string check in users.py swaps to
    `Item.assignee_id == user.id`.

- [ ] **Step 6: Import** — `backend/app/csv_import.py`:
  - `_row_to_data`: `"assignee": g(COL_ASSIGNEE),` stays (parse keeps names).
  - `_insert_item` resolves before constructing:

```python
def _insert_item(db, parsed_item, parent_id, position, assignee_ids):
    from app.models import Item

    data = dict(parsed_item.data)
    raw = data.pop("assignee", None)
    name = str(raw).strip() if raw and str(raw).strip() else None
    item = Item(
        kind=parsed_item.kind,
        parent_id=parent_id,
        position=position,
        assignee_id=assignee_ids.get(name) if name else None,
        **data,
    )
    db.add(item)
    db.flush()
    return item
```

  - `replace_all` builds `assignee_ids` first via a new helper `_resolve_people(db, parsed) -> dict[str, int]`
    that collects stripped assignee names, resolves each with the shared merge rules
    (exact display_name, lowest id) or inserts a login-less `User`, flushes, and
    returns name → id; every `_insert_item` call gains the `assignee_ids` argument.
    `_seed_teams_and_members` keeps seeding `TeamMember` rows in this task (Task 3
    removes that) — but its member seeding may now double-create people; that is
    transitional and removed next task.
  - Add to `backend/tests/test_import_endpoint.py`:

```python
def test_import_creates_login_less_users_and_links_assignees(client, db_session):
    from app.models import Item, User

    with FIXTURE.open("rb") as fh:
        assert post_import(client, fh.read()).status_code == 200
    marco = db_session.query(User).filter_by(display_name="Marco Wartmann").one()
    assert marco.email is None and marco.password_hash is None
    assert db_session.query(Item).filter_by(assignee_id=marco.id).count() > 0
```

- [ ] **Step 7: team_members.py transitional strip** — `rename_member` loses the
  `db.execute(update(Item)...)` propagation block (names live on users now — the
  member copy is vestigial until Task 3 deletes the router); `delete_member` loses its
  guard (`if not force:` block) — delete unconditionally. Drop the now-unused
  `func, update` imports and `Item` import. Delete from `backend/tests/test_api_renames.py`:
  `test_member_rename_propagates_assignee` and `test_member_rename_conflict_and_delete_guard` (−2).
- [ ] **Step 8: test_schema_hygiene.py** — the asserted index set swaps
  `"ix_items_assignee"` for `"ix_items_assignee_id"`.
- [ ] **Step 9: Full backend suite — expect 215 passed** (209 + 6 new + 1 import + 1 appended − 2 renames). Fixture fallout sweep: any test constructing `Item(assignee=...)` or PATCHing `{"assignee": ...}` must be re-keyed (report each).
- [ ] **Step 10: Commit** — `git add backend && git commit -m "feat(backend): items assignee becomes a user FK served as display name"`

---

### Task 3: Capacities re-key + team_members deletion

**Files:**
- Modify: `backend/app/models.py` (Capacity; delete TeamMember + Team.members), `backend/app/schemas.py` (CapacityRead/CapacityUpsert; delete TeamMember* schemas), `backend/app/routers/capacities.py`, `backend/app/main.py` (unregister router), `backend/app/csv_import.py` (seed users), delete `backend/app/routers/team_members.py`
- Tests: delete `backend/tests/test_api_team_members.py` (−5); modify `test_api_capacities.py`, `test_audit_masters.py`, `test_authz.py`, `test_import_endpoint.py`, `test_schema_hygiene.py`

**Interfaces:**
- Produces: `CapacityUpsert/CapacityRead.user_id`; `/api/v1/team-members*` gone (404).

- [ ] **Step 1: Failing first** — apply the test-side re-keys before the code:
  - `test_api_capacities.py`: every `member_id` → `user_id`; member fixtures become
    person users (`client.post("/api/v1/users", json={"display_name": ...})`);
    `test_deleting_member_cascades_capacities` becomes
    `test_deleting_user_cascades_capacities` using `DELETE /api/v1/users/{id}` (person
    without assignments → 204) and asserts the capacity row is gone.
  - `test_audit_masters.py::test_team_and_pi_and_member_events`: drop the
    member-events assertions (team + PI assertions stay; rename the test
    `test_team_and_pi_events`); capacity test re-keys to `user_id` and keeps asserting
    the label shape (now display_name-sourced).
  - `test_authz.py::test_member_blocked_from_admin_mutations`: delete the
    team-members probe lines (the users/teams/PI probes stay untouched).
  - `test_import_endpoint.py::test_import_seeds_members_and_teams` →
    `test_import_seeds_users_and_teams`: asserts `User` rows (email NULL) instead of
    `TeamMember`; `test_reimport_is_idempotent_and_keeps_manual_members` re-keys to
    users (manual person via POST /users; assert single "Marco Wartmann" user after
    two imports).
  - `test_schema_hygiene.py::test_capacity_iteration_check_constraint`: seed a `User`
    instead of `TeamMember` and build `Capacity(user_id=...)`.
  - Delete `backend/tests/test_api_team_members.py`.
- [ ] **Step 2: Models** — Capacity:

```python
    __table_args__ = (
        UniqueConstraint(
            "user_id", "planning_interval", "iteration",
            name="uq_capacity_user_pi_iter",
        ),
        CheckConstraint("iteration >= 1 AND iteration <= 6", name="ck_capacities_iteration"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
```

  Delete the `TeamMember` class and the `members` relationship on `Team`.
- [ ] **Step 3: Schemas** — CapacityRead/CapacityUpsert `member_id` → `user_id`
  (validation message `"user_id does not exist"`); delete `TeamMemberCreate/TeamMemberUpdate/TeamMemberRead`.
- [ ] **Step 4: Router** — capacities.py: `db.get(TeamMember, ...)` → `db.get(User, payload.user_id)`;
  detail `"user_id does not exist"`; audit label `f"{user.display_name} · ..."`; the
  select's where re-keys. Delete `backend/app/routers/team_members.py`; remove its
  import + registration from `backend/app/main.py`.
- [ ] **Step 5: Import** — `_seed_teams_and_members` → `_seed_teams_and_users`: the
  member-creation half now upserts login-less `User` rows via the same
  `_resolve_people` helper (teams half unchanged); `replace_all` call site renamed.
- [ ] **Step 6: Full backend suite — expect 210 passed** (215 − 5).
- [ ] **Step 7: Commit** — `git add backend && git commit -m "feat(backend): capacities re-key to users; team_members removed"`

---

### Task 4: Migration 0015 + seeded rehearsal

**Files:**
- Create: `backend/alembic/versions/0015_merge_members_into_users.py`

- [ ] **Step 1: Write the migration:**

```python
"""Merge team_members into users; items.assignee -> assignee_id FK; capacities -> user_id.

Revision ID: 0015
Revises: 0014
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

_INSERT_PERSON = sa.text(
    "INSERT INTO users (email, display_name, password_hash, role, is_active, auth_provider, team_id, created_at) "
    "VALUES (NULL, :name, NULL, 'member', true, 'local', :team_id, now()) RETURNING id"
)

_FIND_USER = sa.text(
    "SELECT id, team_id FROM users WHERE display_name = :name ORDER BY id LIMIT 1"
)


def _resolve(bind, name: str, team_id=None) -> int:
    row = bind.execute(_FIND_USER, {"name": name}).mappings().first()
    if row:
        return row["id"]
    return bind.execute(_INSERT_PERSON, {"name": name, "team_id": team_id}).scalar_one()


def upgrade() -> None:
    bind = op.get_bind()

    op.alter_column("users", "email", existing_type=sa.String(255), nullable=True)

    mapping: dict[int, int] = {}
    members = bind.execute(
        sa.text("SELECT id, name, team_id FROM team_members ORDER BY id")
    ).mappings().all()
    for m in members:
        row = bind.execute(_FIND_USER, {"name": m["name"]}).mappings().first()
        if row:
            mapping[m["id"]] = row["id"]
            if row["team_id"] is None and m["team_id"] is not None:
                bind.execute(
                    sa.text("UPDATE users SET team_id = :t WHERE id = :u"),
                    {"t": m["team_id"], "u": row["id"]},
                )
        else:
            mapping[m["id"]] = bind.execute(
                _INSERT_PERSON, {"name": m["name"], "team_id": m["team_id"]}
            ).scalar_one()

    op.add_column(
        "items",
        sa.Column(
            "assignee_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_items_assignee_id", "items", ["assignee_id"])
    raw_names = bind.execute(
        sa.text(
            "SELECT DISTINCT assignee FROM items WHERE assignee IS NOT NULL AND trim(assignee) <> ''"
        )
    ).scalars().all()
    for raw in raw_names:
        uid = _resolve(bind, raw.strip())
        bind.execute(
            sa.text("UPDATE items SET assignee_id = :u WHERE assignee = :raw"),
            {"u": uid, "raw": raw},
        )
    op.drop_index("ix_items_assignee", table_name="items")
    op.drop_column("items", "assignee")

    op.add_column(
        "capacities",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    for member_id, user_id in mapping.items():
        bind.execute(
            sa.text("UPDATE capacities SET user_id = :u WHERE member_id = :m"),
            {"u": user_id, "m": member_id},
        )
    op.alter_column("capacities", "user_id", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint("uq_capacity_member_pi_iter", "capacities", type_="unique")
    op.create_unique_constraint(
        "uq_capacity_user_pi_iter",
        "capacities",
        ["user_id", "planning_interval", "iteration"],
    )
    op.drop_column("capacities", "member_id")

    op.drop_table("team_members")


def downgrade() -> None:
    # Best-effort: merged members cannot be un-merged; inherited team_ids stay.
    bind = op.get_bind()

    op.create_table(
        "team_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="SET NULL")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    bind.execute(
        sa.text(
            "INSERT INTO team_members (name, team_id) "
            "SELECT DISTINCT ON (u.display_name) u.display_name, u.team_id FROM users u "
            "WHERE u.email IS NULL "
            "OR u.id IN (SELECT user_id FROM capacities) "
            "OR u.id IN (SELECT assignee_id FROM items WHERE assignee_id IS NOT NULL) "
            "ORDER BY u.display_name, u.id"
        )
    )

    op.add_column(
        "capacities",
        sa.Column(
            "member_id",
            sa.Integer(),
            sa.ForeignKey("team_members.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    bind.execute(
        sa.text(
            "UPDATE capacities SET member_id = tm.id FROM team_members tm, users u "
            "WHERE u.id = capacities.user_id AND tm.name = u.display_name"
        )
    )
    op.alter_column("capacities", "member_id", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint("uq_capacity_user_pi_iter", "capacities", type_="unique")
    op.create_unique_constraint(
        "uq_capacity_member_pi_iter",
        "capacities",
        ["member_id", "planning_interval", "iteration"],
    )
    op.drop_column("capacities", "user_id")

    op.add_column("items", sa.Column("assignee", sa.String(128), nullable=True))
    op.create_index("ix_items_assignee", "items", ["assignee"])
    bind.execute(
        sa.text(
            "UPDATE items SET assignee = u.display_name FROM users u "
            "WHERE items.assignee_id = u.id"
        )
    )
    op.drop_index("ix_items_assignee_id", table_name="items")
    op.drop_column("items", "assignee_id")

    bind.execute(sa.text("DELETE FROM users WHERE email IS NULL"))
    op.alter_column("users", "email", existing_type=sa.String(255), nullable=False)
```

- [ ] **Step 2: Seeded rehearsal against compose Postgres** (this is the acceptance
  gate; run with the copy-dance code in place). At revision 0014 (downgrade first if
  the DB is ahead — it will be at 0014 here since 0015 is new):
  1. Seed via psql: a user `'Existing User'` (email set, team NULL), members
     `'Existing User'` (team A) / `'Member Only'` (team B); an item assigned
     `'Stray Name'` (no member/user); a capacity for `'Member Only'`.
  2. `alembic upgrade head`; assert via psql: `'Existing User'` kept email, gained
     team A; `'Member Only'` and `'Stray Name'` exist with `email IS NULL`; the item's
     `assignee_id` = the stray user's id; the capacity's `user_id` = Member Only's id;
     `team_members` gone; `items.assignee` column gone.
  3. `alembic downgrade 0014`; assert `team_members` recreated containing
     `'Member Only'`/`'Stray Name'`/`'Existing User'`(capacity/assignment-derived),
     `items.assignee` strings restored, login-less users deleted, email NOT NULL back.
  4. `alembic upgrade head` again; delete the seeded scratch rows (users/items/
     capacities created for the rehearsal) so the live data is untouched; leave DB at
     0015 (head).
  Record every command + output in the report. NOTE the live DB also gets genuinely
  migrated by step 2's upgrade — that is intended (this branch deploys 0015 anyway);
  the rehearsal seeds are the only rows you may delete afterwards (delete order:
  scratch capacity → scratch item → scratch users, respecting FKs).
- [ ] **Step 2b: Restart the backend on branch code** — the RUNNING process still
  holds pre-merge models and would 500 against the migrated schema. The copy-dance
  already placed branch code in /app/app; run `docker compose restart backend` (the
  entrypoint's `alembic upgrade head` no-ops at 0015). Known, accepted degradation
  until Task 10 rebuilds the frontend: the OLD frontend build still sends
  `assignee`-string PATCHes, which now 422 in the drawer; reads are unaffected
  (`assignee` display names are still served). Note this in your report so the
  controller can tell the user.
- [ ] **Step 3: Full backend suite — expect 210 passed** (no pytest change).
- [ ] **Step 4: Commit** — `git add backend && git commit -m "feat(backend): migration 0015 — merge members into users, assignee FK, capacity re-key"`

---

### Task 5: Snapshot restore assignee repair

**Files:**
- Modify: `backend/app/snapshots.py` (restore_from_snapshot), `backend/tests/test_snapshot_restore.py` (+2 tests)

- [ ] **Step 1: Failing tests** — append to `backend/tests/test_snapshot_restore.py`:

```python
def test_restore_clears_dangling_assignees_with_warning(client, db_session):
    person = client.post("/api/v1/users", json={"display_name": "Doomed"}).json()
    item = Item(kind=ItemKind.FEATURE, title="Owned", position=0, assignee_id=person["id"])
    db_session.add(item)
    db_session.commit()
    name = write_snapshot(db_session, actor="a@x.local")
    _wipe(db_session)
    assert client.delete(f"/api/v1/users/{person['id']}").status_code == 204

    body = client.post(f"/api/v1/import/snapshots/{name}/restore").json()
    assert "Cleared assignee for 1 item(s) whose user no longer exists" in body["warnings"]
    db_session.expire_all()
    assert db_session.query(Item).filter_by(title="Owned").one().assignee_id is None


def test_restore_legacy_snapshot_warns_and_unassigns(client, db_session):
    import json as _json
    import os
    from pathlib import Path

    _seed_rich(db_session)
    name = write_snapshot(db_session, actor="a@x.local")
    path = Path(os.environ["SNAPSHOT_DIR"]) / name
    data = _json.loads(path.read_text())
    for row in data["items"]:
        row.pop("assignee_id", None)
        row["assignee"] = "Legacy Name"
    path.write_text(_json.dumps(data))
    _wipe(db_session)

    body = client.post(f"/api/v1/import/snapshots/{name}/restore").json()
    assert "Legacy snapshot: assignee names were not restored" in body["warnings"]
    db_session.expire_all()
    assert all(i.assignee_id is None for i in db_session.query(Item))
```

- [ ] **Step 2: Implement** — in `restore_from_snapshot`, before building `item_rows`:

```python
    raw_items = data.get("items", [])
    legacy_assignee = any("assignee" in r for r in raw_items)
    if legacy_assignee:
        warnings.append("Legacy snapshot: assignee names were not restored")
    item_rows = [_revive(Item, r) for r in raw_items]
    existing_user_ids = set(db.scalars(select(User.id)))
    cleared_assignees = 0
    for row in item_rows:
        if row.get("assignee_id") is not None and row["assignee_id"] not in existing_user_ids:
            row["assignee_id"] = None
            cleared_assignees += 1
    if cleared_assignees:
        warnings.append(
            f"Cleared assignee for {cleared_assignees} item(s) whose user no longer exists"
        )
```

  (`existing_users` for comments already exists later — reuse one
  `existing_user_ids` set for both; `User` import already local to the function.
  `_revive` ignores unknown keys like legacy `"assignee"` by construction.)
- [ ] **Step 3: Full backend suite — expect 212 passed** (210 + 2).
- [ ] **Step 4: Commit** — `git add backend && git commit -m "feat(backend): snapshot restore repairs dangling assignees"`

---

### Task 6: Frontend types + client (additive) + fixture sweep

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/api/client.ts`, `frontend/src/api/client.test.ts`, plus the mechanical Item-fixture sweep (14 test files)

- [ ] **Step 1: Types** — in `frontend/src/types.ts`:
  - `Item` gains `assignee_id: number | null;` directly after `assignee: string | null;`
    (assignee STAYS — it is the served display name).
  - `ItemUpdate` type: replace `assignee?: string | null` with `assignee_id?: number | null`.
  - After `TeamMember` (which stays until Task 9) add:

```ts
export interface PersonOption {
  id: number;
  display_name: string;
}
```

  - `Capacity.member_id` stays until Task 8's coordinated switch? NO — the backend is
    already `user_id`; T6 renames it: `member_id: number` → `user_id: number` and the
    fixture/lib fallout lands in Task 8… **Binding resolution: rename in Task 6 AND
    mechanically sweep `member_id` → `user_id` in `lib/capacity.ts`,
    `lib/capacity.test.ts`, `CapacitySection.tsx/.test.tsx`, `PlanningView.tsx` in the
    same commit (pure rename, no logic change — Task 8 does the people-source logic).**
  - `AuthUser`/`User` email becomes `string | null`.
- [ ] **Step 2: Client** — `frontend/src/api/client.ts`: add

```ts
export function getPersonOptions(): Promise<PersonOption[]> {
  return request<PersonOption[]>(`${API}/users/options`);
}

export function deleteUser(id: number, force = false): Promise<void> {
  return request<void>(`${API}/users/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });
}
```

  `upsertCapacity`'s payload type re-keys to `user_id`. Member fns stay until Task 9.
- [ ] **Step 3: Client tests** — add to `client.test.ts` (2 new):

```ts
  it("getPersonOptions fetches /api/v1/users/options", async () => {
    const spy = mockFetch(200, [{ id: 1, display_name: "P" }]);
    const people = await getPersonOptions();
    expect(spy).toHaveBeenCalledWith("/api/v1/users/options", undefined);
    expect(people[0].display_name).toBe("P");
  });

  it("deleteUser hits DELETE with optional force", async () => {
    const spy = mockFetch(204, null);
    await deleteUser(7, true);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/users/7?force=true");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });
```

- [ ] **Step 4: Fixture sweep** — `Item.assignee_id` is REQUIRED, so tsc forces every
  Item fixture to gain `assignee_id`. Rule: fixtures with `assignee: null` (or absent)
  get `assignee_id: null`; fixtures with `assignee: "<name>"` get a stable fake id
  (`assignee_id: 1` unless the test distinguishes people — then distinct ids). Files
  (verified list): BoardView, PlanningView, Card, ItemDrawerLinks, ItemDrawerFields,
  StoryPlanCard, StoryBoardModal, Toolbar, ItemDrawerStories, ItemDrawer,
  ItemDrawerAssignee, groupByStatus, boardLanes, capacity tests. Any fixture PATCH
  expectation using `assignee` re-keys to `assignee_id` ONLY where it asserts an
  update payload (reads keep `assignee`).
- [ ] **Step 5:** `npx tsc --noEmit` clean; `npx vitest run` — **expect 194 passed**
  (192 + 2; sweeps keep counts).
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(frontend): person options + assignee_id types, capacity user_id re-key"`

---

### Task 7: Drawer + App wiring (id-valued assignee)

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/components/ItemDrawer.tsx`, `frontend/src/components/ItemDrawerAssignee.test.tsx` (1 → 2 tests)

- [ ] **Step 1: App** — replace the member-based options effect:

```ts
  const [people, setPeople] = useState<PersonOption[]>([]);
  useEffect(() => {
    void getPersonOptions().then(setPeople);
  }, [refreshKey]);
```

  (imports swap `getTeamMembers` → `getPersonOptions`; the `assigneeOptions` state
  dies). Pass `people={people}` where `assigneeOptions` was passed to the drawer. The
  separate `assignees` memo (Person filter from loaded items) is untouched.
- [ ] **Step 2: Drawer** — `ItemDrawer.tsx`: prop `assigneeOptions?: string[]` →
  `people?: PersonOption[]` (default `[]`); the Assignee field becomes:

```tsx
            <SearchableSelect
              ariaLabel="Assignee"
              value={
                people.find((p) => p.id === (value("assignee_id") as number | null))
                  ?.display_name ?? (item.assignee || null)
              }
              options={people.map((p) => p.display_name)}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  assignee_id: v == null ? null : people.find((p) => p.display_name === v)?.id ?? null,
                }))
              }
              placeholder="Search person…"
            />
```

  (`value("assignee_id")` reads draft-or-item as the existing `value()` helper does —
  confirm the helper covers non-string fields; it reads `draft[k] ?? item[k]`,
  which works for numbers.) Duplicate display names resolve to the first match —
  accepted, documented.
- [ ] **Step 3: Test** — rewrite `ItemDrawerAssignee.test.tsx` to 2 tests: selecting
  a person calls `updateItem` with `{ assignee_id: <id>, version: ... }` (mock
  `people=[{id: 7, display_name: "Worker"}]`, existing save-path mocks); clearing
  sends `assignee_id: null`. Keep the file's existing render/save harness idioms.
- [ ] **Step 4:** tsc clean; vitest — **expect 195 passed** (194 + 1).
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "feat(frontend): drawer assignee select is user-id valued"`

---

### Task 8: Planning + capacity people source

**Files:**
- Modify: `frontend/src/lib/capacity.ts`, `frontend/src/lib/capacity.test.ts`, `frontend/src/components/PlanningView.tsx`, `frontend/src/components/PlanningView.test.tsx`, `frontend/src/components/admin/CapacitySection.tsx`, `frontend/src/components/admin/CapacitySection.test.tsx`

- [ ] **Step 1: lib/capacity.ts** — re-key to people + id matching:
  - `MemberLoadRow.member: TeamMember | null` → `person: PersonOption | null` (rename
    the field everywhere; `loadCapacityRows(members: TeamMember[], ...)` →
    `loadCapacityRows(people: PersonOption[], ...)`).
  - Load matching switches from name to id:
    `rows = people.map((p) => buildRow(p, (s) => s.assignee_id === p.id));`
    `const personIds = new Set(people.map((p) => p.id));`
    `const unassigned = buildRow(null, (s) => s.assignee_id == null || !personIds.has(s.assignee_id));`
  - Capacity matching: `c.user_id !== person.id` (already renamed in T6).
- [ ] **Step 2: PlanningView** — concrete transformations (behavior contract:
  identical UI, id-keyed capacity math):
  - `const [members, setMembers] = useState<TeamMember[]>([])` →
    `const [people, setPeople] = useState<PersonOption[]>([])`, loaded via
    `getPersonOptions()` where `getTeamMembers()` was called.
  - Every `loadCapacityRows(members, ...)` call passes `people`.
  - The `assigneeName` person filter stays display-name-based: its option list still
    derives from the PI stories' `s.assignee` strings (unchanged), and story scoping
    keeps comparing `i.assignee === assigneeName` (both are served display names).
  - Any `row.member` field access renames to `row.person` (lib rename), labels via
    `row.person?.display_name`.
- [ ] **Step 3: CapacitySection** — people list from `getPersonOptions()`;
  `upsertCapacity({ user_id: person.id, ... })`; row labels `display_name`.
- [ ] **Step 4: Tests** — mechanical re-key of fixtures/mocks in the three test files
  (TeamMember fixtures → PersonOption, `member_id` → `user_id` already done in T6,
  `getTeamMembers` mocks → `getPersonOptions`). Counts unchanged.
- [ ] **Step 5:** tsc clean; vitest — **expect 195 passed**.
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(frontend): planning + capacity keyed to users"`

---

### Task 9: Admin person manager + member remnants deleted

**Files:**
- Modify: `frontend/src/components/admin/UsersSection.tsx` (+ its test, 2 → 4), `frontend/src/components/admin/UserModal.tsx` (+ its test, 4 → 6), `frontend/src/components/admin/AdminView.tsx` (+ test mocks), `frontend/src/types.ts` (delete TeamMember), `frontend/src/api/client.ts` (delete member fns), `frontend/src/api/client.renames.test.ts` (−2 member tests)
- Delete: `frontend/src/components/admin/TeamMembersSection.tsx`

- [ ] **Step 1: UserModal** — email/password become truly optional in create mode:
  - `valid` becomes: name non-empty AND (email empty ⇒ password empty) AND (password
    entered ⇒ length ≥ 8 and email present) — concretely:

```ts
  const emailOk = email.trim() === "" || email.trim().length >= 3;
  const passwordOk =
    password === "" ? true : password.length >= 8 && email.trim().length >= 3;
  const valid = name.trim().length > 0 && emailOk && passwordOk;
```

  - create payload: `email: email.trim() === "" ? null : email.trim()`, `password:
    password === "" ? null : password` (updateUser diff for edit mode: email diff
    compares against `user.email ?? ""`; sending `email: null` when the field was
    cleared and the user had one).
  - Email input placeholder: `"Optional — needed to log in"`.
  - +2 tests: creating with name only posts `{display_name, email: null, password: null, role, team_id}`;
    clearing the email of a passworded user surfaces the server detail
    ("Remove the password first" via mocked ConflictError-like rejection — use the
    existing errorDetail harness).
- [ ] **Step 2: UsersSection** — email cell renders `u.email ?? "—"`; header button
  copy becomes `+ Add person`; add a Delete button per row (not for
  `u.id === currentUserId`), P1 idiom:

```tsx
  const remove = async (u: AuthUser) => {
    setError(null);
    try {
      await deleteUser(u.id);
    } catch (e) {
      if (e instanceof ConflictError) {
        if (!e.detail.includes("deactivate instead") && window.confirm(`${e.detail} Delete anyway?`)) {
          try {
            await deleteUser(u.id, true);
          } catch (forced) {
            setError(forced instanceof Error ? forced.message : "Could not delete the user.");
            return;
          }
        } else {
          if (e.detail.includes("deactivate instead")) setError(e.detail);
          return;
        }
      } else {
        setError(e instanceof Error ? e.message : "Could not delete the user.");
        return;
      }
    }
    reload();
  };
```

  with an `error` state line above the table and a per-row
  `aria-label={`delete user ${u.display_name}`}` button. +2 tests: guarded delete
  (ConflictError with assignment detail → confirm accepted → force call); comments
  detail shows error, no confirm.
- [ ] **Step 3: AdminView** — remove `TeamMembersSection` import/usage (grid keeps
  Teams + PlanningIntervals; adjust the grid columns class `lg:grid-cols-3` →
  `md:grid-cols-2` for the two remaining cards); delete the component file; update
  AdminView.test mocks (drop getTeamMembers, keep listUsers etc.).
- [ ] **Step 4: Types/client cleanup** — delete `TeamMember` interface,
  `getTeamMembers/createTeamMember/renameTeamMember/deleteTeamMember`; delete the two
  member-fn tests in `client.renames.test.ts`; repo-wide grep
  `TeamMember|team-members` must return ZERO frontend hits.
- [ ] **Step 5:** tsc clean; vitest — **expect 197 passed** (195 + 4 − 2).
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(frontend): users section is the person manager; team members UI removed"`

---

### Task 10: Pre-migration dump, deploy, smoke

**Files:** none committed (verification only).

- [ ] **Step 1: PRE-DEPLOY SAFETY DUMP** (the running stack is still on 0014 images —
  BUT the DB is already at 0015 from Task 4's rehearsal; the dump still captures the
  post-merge state for recovery). Write `/tmp/dump0015.py`:

```python
import json
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select

from app.db import SessionLocal
from app import models


def rows(db, model):
    t = model.__table__
    out = []
    for row in db.execute(select(t).order_by(t.c.id)).mappings():
        out.append({k: (v.isoformat() if isinstance(v, datetime) else float(v) if isinstance(v, Decimal) else v) for k, v in row.items()})
    return out


with SessionLocal() as db:
    payload = {
        "users": rows(db, models.User),
        "capacities": rows(db, models.Capacity),
        "items": rows(db, models.Item),
    }
with open("/app/snapshots/pre-merge-dump.json", "w") as fh:
    json.dump(payload, fh)
print({k: len(v) for k, v in payload.items()})
```

  `docker compose cp /tmp/dump0015.py backend:/tmp/dump0015.py && docker compose exec -T backend python /tmp/dump0015.py`
  (recovery artifact only — lands on the snapshots volume; passwords hashes included,
  volume is local).
- [ ] **Step 2: Rebuild** — `docker compose up -d --build backend frontend` (alembic
  no-ops at 0015).
- [ ] **Step 3: Suites at HEAD on new images** — backend copy-dance **212 passed**
  (then `rm -rf /app/tests`); frontend **197 passed** + tsc clean.
- [ ] **Step 4: Smoke (read-only + scratch-person only):**

```bash
docker compose exec -T backend alembic current                      # 0015 (head)
curl -s -c /tmp/kb.jar -X POST http://localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"admin"}' >/dev/null
curl -s -b /tmp/kb.jar http://localhost:8080/api/v1/users/options | head -c 300   # people incl. former members
curl -s -b /tmp/kb.jar 'http://localhost:8080/api/v1/items?limit=1' | python3 -c 'import json,sys; i=json.load(sys.stdin)["items"][0]; print(i.get("assignee"), i.get("assignee_id"))'
curl -s -b /tmp/kb.jar http://localhost:8080/api/v1/capacities | head -c 200      # user_id-keyed
# scratch person lifecycle (safe): create -> options contains -> delete
curl -s -b /tmp/kb.jar -X POST http://localhost:8080/api/v1/users -H 'Content-Type: application/json' -d '{"display_name":"Smoke Scratch Person"}'
# capture the id, verify 204 delete, verify options no longer contains it
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/kb.jar http://localhost:8080/api/v1/team-members   # 404
```

  DO NOT delete or modify any real person/user; the scratch person is the only
  mutation.
- [ ] **Step 5: Report DONE with outputs.** Controller performs the browser check
  (board assignees render, drawer select works against real people, Admin person
  manager, capacity view) before the final review.
