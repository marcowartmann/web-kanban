# Import Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the destructive CSV import safe: dry-run preview + informed confirm with race guards, automatic pre-import JSON snapshot (items + comments + links) to a volume, self-service restore from the Admin page, and the P2 delete-race 409 fold-in.

**Architecture:** New `backend/app/snapshots.py` owns state-stamp computation, snapshot write/list/validate/prune, and restore; the imports router gains `/import/preview`, guard fields on `/import`, and `/import/snapshots` list/download/restore endpoints. Frontend: `ImportButton` swaps `window.confirm` for a preview modal; new `SnapshotsSection` on the Admin page. No DB migration.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 core selects/inserts, Pydantic v2, pytest (SQLite in-memory); React 18 + TS + Tailwind, vitest + testing-library.

**Spec:** `docs/superpowers/specs/2026-07-02-import-safety-design.md`

## Global Constraints

- Branch: `feat/import-safety` off main (b2e7ccc + spec commit).
- Error details EXACT:
  - 400 `"Uploaded file does not match the previewed file"`
  - 409 `"Data changed since preview — run the preview again"` (em dash U+2014)
  - 500 `"Snapshot could not be written — import aborted"` (em dash U+2014)
  - 404 `"Snapshot not found"`
  - delete-race 409 `"Item was modified by someone else — reload and retry"` (same string update_item uses; em dash U+2014)
- State stamp EXACT: `sha256(f"{ic}:{im}:{iv}:{cc}:{cm}:{lc}:{lm}".encode()).hexdigest()[:16]` — items count / max id / sum version, comments count / max id, item_links count / max id, each `coalesce(..., 0)`.
- Snapshot filename EXACT: `import-snapshot-{UTC:%Y%m%dT%H%M%S}-{microsecond:06d}Z.json`; validation regex `^import-snapshot-\d{8}T\d{6}-\d{6}Z\.json$` is the only name gate (also the traversal guard). Retention keeps the newest **20** by name sort.
- `SNAPSHOT_DIR` env var read at **call time** (function, not module constant), default `/app/snapshots`. Tests: autouse conftest fixture pointing at `tmp_path`.
- Restore deletes comments, links, then items **explicitly** (no reliance on FK cascade — SQLite tests run without FK enforcement), re-inserts with original ids via core inserts, items in two passes (`parent_id` NULL first, then update), comments kept only if author exists and parent kept, warnings EXACT: `f"Skipped {n} comment(s) whose author no longer exists"`, `f"Skipped {n} comment(s) whose parent comment was skipped"`. Postgres-only setval via `pg_get_serial_sequence`.
- Audit: `import.replaced` new_value becomes `f"features={r.features} stories={r.stories} risks={r.risks} snapshot={name}"`; new `import.restored` event `entity_type="import"`, `entity_label=<name>`, `new_value=f"items={i} comments={c} links={l}"`.
- Frontend copy EXACT (see Task 6/7 code): modal title `Replace all data from CSV?`, buttons `Cancel` / `Replace all data`, note `A snapshot is saved automatically before the import.`, empty state `No snapshots yet — one is created automatically before every import.`
- Suite math: backend 166 → 167 (T1) → 172 (T2) → 179 (T3) → 187 (T4); frontend 181 → 184 (T5) → 188 (T6) → 192 (T7). Task 8 changes no counts.
- ENV (backend tasks): the backend container does NOT bind-mount code. Before pytest:
  ```bash
  docker compose exec -T backend sh -c 'rm -rf /app/app /app/alembic /app/tests'
  docker compose cp ./backend/app backend:/app/app
  docker compose cp ./backend/alembic backend:/app/alembic
  docker compose cp ./backend/tests backend:/app/tests
  docker compose exec -T backend pip install -q "pytest>=8.2" "httpx>=0.27" "bcrypt>=4.1"
  docker compose exec -T backend python -m pytest -q /app/tests
  ```
  Frontend tests run on the host (`cd frontend && npx vitest run`, `npx tsc --noEmit`).

---

### Task 1: Delete-race 409 (P2 fold-in)

**Files:**
- Modify: `backend/app/routers/items.py` (delete_item, ~line 178)
- Test: `backend/tests/test_item_version.py`

**Interfaces:**
- Consumes: existing `StaleDataError` import in items.py (line 4), `_create` helper in test_item_version.py.
- Produces: DELETE `/api/v1/items/{id}` returns 409 (not 500) when a concurrent edit bumps the version mid-flight.

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_item_version.py`.
  The held `stale` reference is load-bearing: session identity-map entries are weakly
  referenced, so without it the instance created via the API is garbage-collected and the
  handler's `db.get` re-reads the bumped row (version=99), making the predicate match and
  the test pass vacuously (204).

```python
def test_delete_race_is_caught_by_version_predicate(client, db_session):
    from sqlalchemy import update

    from app.models import Item

    item = _create(client)
    # Hold a strong reference so the identity map keeps the stale instance
    # and the handler's db.get serves it (entries are weakly referenced).
    stale = db_session.get(Item, item["id"])
    assert stale.version == 1
    db_session.execute(
        update(Item).where(Item.id == item["id"]).values(version=99)
        .execution_options(synchronize_session=False)
    )
    resp = client.delete(f"/api/v1/items/{item['id']}")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Item was modified by someone else — reload and retry"
    assert client.get(f"/api/v1/items/{item['id']}").status_code == 200
```

- [ ] **Step 2: Run it — expect FAIL** (unhandled `StaleDataError` surfaces as a 500/exception, not 409). Use the ENV protocol, then:
  `docker compose exec -T backend python -m pytest -q /app/tests/test_item_version.py -k delete_race`

- [ ] **Step 3: Implement** — in `backend/app/routers/items.py`, `delete_item` currently ends:

```python
    db.delete(item)  # ORM cascade removes child stories
    db.commit()
```

Replace those two lines with:

```python
    db.delete(item)  # ORM cascade removes child stories
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Item was modified by someone else — reload and retry",
        )
```

- [ ] **Step 4: Run the full backend suite — expect 167 passed.**
- [ ] **Step 5: Commit** — `git add backend && git commit -m "fix: delete-race StaleDataError maps to 409 like updates"`

---

### Task 2: Snapshots module (write, list, validate, prune, state stamp)

**Files:**
- Create: `backend/app/snapshots.py`
- Modify: `backend/tests/conftest.py` (autouse SNAPSHOT_DIR fixture)
- Test: `backend/tests/test_snapshots.py` (new, 5 tests)

**Interfaces:**
- Produces (used by Tasks 3-4):
  - `compute_state_stamp(db: Session) -> str`
  - `write_snapshot(db: Session, actor: str) -> str` (returns filename; mkdirs; prunes)
  - `list_snapshots() -> list[dict]` (`{name, created_at, actor, items, comments, links}`, newest first)
  - `snapshot_path(name: str) -> Path | None` (regex + existence gate)
  - `restore_from_snapshot` is Task 4, same module.

- [ ] **Step 1: Add the autouse fixture** — append to `backend/tests/conftest.py`:

```python
@pytest.fixture(autouse=True)
def _snapshot_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("SNAPSHOT_DIR", str(tmp_path / "snapshots"))
```

- [ ] **Step 2: Write the failing tests** — create `backend/tests/test_snapshots.py`:

```python
import json
import os
from pathlib import Path

from app.models import Comment, Item, ItemKind, ItemLink, User
from app.snapshots import (
    FILENAME_RE,
    compute_state_stamp,
    list_snapshots,
    snapshot_path,
    write_snapshot,
)


def _seed(db):
    author = User(email="c@x.local", display_name="C", password_hash=None, role="member")
    db.add(author)
    db.flush()
    a = Item(kind=ItemKind.FEATURE, title="A", position=0, wsjf_score=3.5)
    db.add(a)
    db.flush()
    b = Item(kind=ItemKind.STORY, title="B", parent_id=a.id, position=0)
    db.add(b)
    db.flush()
    db.add(Comment(item_id=a.id, author_id=author.id, body="hello"))
    db.add(ItemLink(source_id=a.id, target_id=b.id, relation="blocks"))
    db.commit()
    return a, b


def _dir():
    return Path(os.environ["SNAPSHOT_DIR"])


def test_write_snapshot_contents(db_session):
    a, b = _seed(db_session)
    name = write_snapshot(db_session, actor="admin@x.local")
    assert FILENAME_RE.match(name)
    data = json.loads((_dir() / name).read_text())
    assert data["schema"] == 1
    assert data["actor"] == "admin@x.local"
    assert data["counts"] == {"items": 2, "comments": 1, "links": 1}
    items = {row["title"]: row for row in data["items"]}
    assert items["B"]["parent_id"] == a.id
    assert isinstance(items["A"]["kind"], str)          # raw persisted enum value
    assert items["A"]["wsjf_score"] == 3.5              # Decimal -> float
    assert isinstance(items["A"]["created_at"], str)    # datetime -> ISO string
    assert data["comments"][0]["body"] == "hello"
    assert data["links"][0]["relation"] == "blocks"


def test_write_snapshot_prunes_to_twenty(db_session):
    d = _dir()
    d.mkdir(parents=True, exist_ok=True)
    for i in range(22):
        (d / f"import-snapshot-20260101T0000{i:02d}-000000Z.json").write_text("{}")
    (d / "not-a-snapshot.json").write_text("{}")
    name = write_snapshot(db_session, actor="a@x.local")
    kept = sorted(p.name for p in d.iterdir() if FILENAME_RE.match(p.name))
    assert len(kept) == 20
    assert name in kept                       # newest survives
    assert kept[0] > "import-snapshot-20260101T000002-000000Z.json"  # oldest pruned
    assert (d / "not-a-snapshot.json").exists()  # non-matching files untouched


def test_list_snapshots_newest_first_with_metadata(db_session):
    _seed(db_session)
    first = write_snapshot(db_session, actor="one@x.local")
    second = write_snapshot(db_session, actor="two@x.local")
    listed = list_snapshots()
    assert [s["name"] for s in listed] == sorted([first, second], reverse=True)
    newest = listed[0]
    assert newest["actor"] in {"one@x.local", "two@x.local"}
    assert newest["items"] == 2 and newest["comments"] == 1 and newest["links"] == 1
    assert newest["created_at"]


def test_snapshot_path_rejects_bad_names(db_session):
    name = write_snapshot(db_session, actor="a@x.local")
    assert snapshot_path(name) is not None
    assert snapshot_path("../etc/passwd") is None
    assert snapshot_path("items.json") is None
    assert snapshot_path("import-snapshot-XXX.json") is None
    assert snapshot_path("import-snapshot-20990101T000000-000000Z.json") is None  # valid form, missing


def test_compute_state_stamp_moves_on_changes(client, db_session):
    stamps = [compute_state_stamp(db_session)]

    item = client.post("/api/v1/items", json={"kind": "feature", "title": "S"}).json()
    stamps.append(compute_state_stamp(db_session))

    client.patch(f"/api/v1/items/{item['id']}", json={"title": "S2", "version": 1})
    stamps.append(compute_state_stamp(db_session))

    other = client.post("/api/v1/items", json={"kind": "feature", "title": "T"}).json()
    client.post("/api/v1/links", json={"source_id": item["id"], "target_id": other["id"], "relation": "blocks"})
    stamps.append(compute_state_stamp(db_session))

    client.post(f"/api/v1/items/{item['id']}/comments", json={"body": "hi"})
    stamps.append(compute_state_stamp(db_session))

    assert len(set(stamps)) == len(stamps)
    assert all(len(s) == 16 for s in stamps)
```

- [ ] **Step 3: Run — expect FAIL** (`ModuleNotFoundError: app.snapshots`).

- [ ] **Step 4: Implement** — create `backend/app/snapshots.py`:

```python
"""Import-safety snapshots: state stamps, pre-import JSON snapshots, restore.

Snapshots capture the three tables a CSV import destroys (items, comments,
item_links) as raw persisted row values, so a restore can re-insert them
byte-for-byte with their original ids.
"""

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Comment, Item, ItemLink

SNAPSHOT_KEEP = 20
FILENAME_RE = re.compile(r"^import-snapshot-\d{8}T\d{6}-\d{6}Z\.json$")


def _snapshot_dir() -> Path:
    # Read at call time so tests can repoint it via SNAPSHOT_DIR.
    return Path(os.environ.get("SNAPSHOT_DIR", "/app/snapshots"))


def compute_state_stamp(db: Session) -> str:
    ic = db.scalar(select(func.count()).select_from(Item)) or 0
    im = db.scalar(select(func.coalesce(func.max(Item.id), 0)))
    iv = db.scalar(select(func.coalesce(func.sum(Item.version), 0)))
    cc = db.scalar(select(func.count()).select_from(Comment)) or 0
    cm = db.scalar(select(func.coalesce(func.max(Comment.id), 0)))
    lc = db.scalar(select(func.count()).select_from(ItemLink)) or 0
    lm = db.scalar(select(func.coalesce(func.max(ItemLink.id), 0)))
    raw = f"{ic}:{im}:{iv}:{cc}:{cm}:{lc}:{lm}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _jsonable(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _rows(db: Session, model) -> list[dict]:
    table = model.__table__
    result = db.execute(select(table).order_by(table.c.id))
    return [{k: _jsonable(v) for k, v in row.items()} for row in result.mappings()]


def write_snapshot(db: Session, actor: str) -> str:
    now = datetime.now(timezone.utc)
    name = f"import-snapshot-{now:%Y%m%dT%H%M%S}-{now.microsecond:06d}Z.json"
    items = _rows(db, Item)
    comments = _rows(db, Comment)
    links = _rows(db, ItemLink)
    payload = {
        "schema": 1,
        "created_at": now.isoformat(),
        "actor": actor,
        "counts": {"items": len(items), "comments": len(comments), "links": len(links)},
        "items": items,
        "comments": comments,
        "links": links,
    }
    directory = _snapshot_dir()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text(json.dumps(payload))
    _prune(directory)
    return name


def _prune(directory: Path) -> None:
    names = sorted(
        (p.name for p in directory.iterdir() if FILENAME_RE.match(p.name)),
        reverse=True,
    )
    for stale in names[SNAPSHOT_KEEP:]:
        (directory / stale).unlink()


def snapshot_path(name: str) -> Path | None:
    if not FILENAME_RE.match(name):
        return None
    path = _snapshot_dir() / name
    return path if path.is_file() else None


def list_snapshots() -> list[dict]:
    directory = _snapshot_dir()
    if not directory.is_dir():
        return []
    out: list[dict] = []
    for name in sorted(
        (p.name for p in directory.iterdir() if FILENAME_RE.match(p.name)),
        reverse=True,
    ):
        data = json.loads((directory / name).read_text())
        counts = data.get("counts", {})
        out.append(
            {
                "name": name,
                "created_at": data.get("created_at", ""),
                "actor": data.get("actor", ""),
                "items": counts.get("items", 0),
                "comments": counts.get("comments", 0),
                "links": counts.get("links", 0),
            }
        )
    return out
```

- [ ] **Step 5: Run the full backend suite — expect 172 passed** (167 + 5).
- [ ] **Step 6: Commit** — `git add backend && git commit -m "feat(backend): snapshot module with state stamps, retention, name gate"`

---

### Task 3: Preview endpoint + confirm-only import + snapshot wiring

**Files:**
- Modify: `backend/app/schemas.py` (after `ImportResult`), `backend/app/routers/imports.py`
- Create: `backend/tests/import_helpers.py`
- Test: `backend/tests/test_import_preview.py` (new, 7 tests)
- Modify tests: `backend/tests/test_import_endpoint.py` (5 import POSTs), `backend/tests/test_audit_links_import.py` (1 POST + audit value)

**Interfaces:**
- Consumes: `compute_state_stamp`, `write_snapshot` from Task 2.
- Produces: `POST /api/v1/import/preview` → `ImportPreview`; `POST /api/v1/import` requires form fields `state_stamp`, `file_sha256`; tests use `import_helpers.post_import(client, data, name)`.

- [ ] **Step 1: Add schemas** — in `backend/app/schemas.py`, directly after the `ImportResult` class:

```python
class ImportPreviewIncoming(BaseModel):
    features: int
    stories: int
    risks: int
    warnings: list[str]


class ImportPreviewCurrent(BaseModel):
    features: int
    stories: int
    risks: int
    comments: int
    links: int


class ImportPreview(BaseModel):
    file_sha256: str
    state_stamp: str
    incoming: ImportPreviewIncoming
    current: ImportPreviewCurrent
    added_titles: list[str]
    removed_titles: list[str]
    added_more: int
    removed_more: int
```

- [ ] **Step 2: Create the shared test helper** — `backend/tests/import_helpers.py`:

```python
"""Preview-then-confirm helper so tests exercise the real two-step flow."""

import io


def post_import(client, data: bytes, name: str = "p.csv"):
    preview = client.post(
        "/api/v1/import/preview", files={"file": (name, io.BytesIO(data), "text/csv")}
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    return client.post(
        "/api/v1/import",
        files={"file": (name, io.BytesIO(data), "text/csv")},
        data={"state_stamp": body["state_stamp"], "file_sha256": body["file_sha256"]},
    )
```

- [ ] **Step 3: Write the failing tests** — create `backend/tests/test_import_preview.py`:

```python
import hashlib
import io
import os
from pathlib import Path

from app.models import AuditEvent, Item
from tests.import_helpers import post_import

_FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def _csv(titles: list[str]) -> bytes:
    lines = ["Title,Type"] + [f"{t},Feature" for t in titles]
    return "\n".join(lines).encode()


def _preview(client, data: bytes):
    resp = client.post(
        "/api/v1/import/preview", files={"file": ("p.csv", io.BytesIO(data), "text/csv")}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_preview_returns_counts_and_guards(client):
    client.post("/api/v1/items", json={"kind": "feature", "title": "Old"})
    data = _FIXTURE.read_bytes()
    body = _preview(client, data)
    assert body["file_sha256"] == hashlib.sha256(data).hexdigest()
    assert len(body["state_stamp"]) == 16
    assert body["incoming"]["risks"] == 9
    assert body["incoming"]["features"] > 0
    assert body["incoming"]["stories"] > 0
    assert body["current"] == {"features": 1, "stories": 0, "risks": 0, "comments": 0, "links": 0}


def test_preview_writes_nothing(client, db_session):
    client.post("/api/v1/items", json={"kind": "feature", "title": "Keep"})
    items_before = db_session.query(Item).count()
    audit_before = db_session.query(AuditEvent).count()
    _preview(client, _FIXTURE.read_bytes())
    assert db_session.query(Item).count() == items_before
    assert db_session.query(AuditEvent).count() == audit_before
    snapshot_dir = Path(os.environ["SNAPSHOT_DIR"])
    assert not snapshot_dir.exists() or not any(snapshot_dir.iterdir())


def test_preview_title_diffs_and_caps(client):
    client.post("/api/v1/items", json={"kind": "feature", "title": "Removed-1"})
    client.post("/api/v1/items", json={"kind": "feature", "title": "Shared"})
    incoming = [f"Added-{i:02d}" for i in range(25)] + ["Shared"]
    body = _preview(client, _csv(incoming))
    assert body["added_titles"] == sorted([f"Added-{i:02d}" for i in range(25)])[:20]
    assert body["added_more"] == 5
    assert body["removed_titles"] == ["Removed-1"]
    assert body["removed_more"] == 0


def test_import_without_guard_fields_is_422(client):
    resp = client.post(
        "/api/v1/import",
        files={"file": ("p.csv", io.BytesIO(_csv(["A"])), "text/csv")},
    )
    assert resp.status_code == 422


def test_import_sha_mismatch_400(client):
    body = _preview(client, _csv(["A"]))
    resp = client.post(
        "/api/v1/import",
        files={"file": ("p.csv", io.BytesIO(_csv(["B"])), "text/csv")},
        data={"state_stamp": body["state_stamp"], "file_sha256": body["file_sha256"]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Uploaded file does not match the previewed file"


def test_import_stamp_mismatch_409(client, db_session):
    data = _csv(["A"])
    body = _preview(client, data)
    client.post("/api/v1/items", json={"kind": "feature", "title": "Sneaky edit"})
    resp = client.post(
        "/api/v1/import",
        files={"file": ("p.csv", io.BytesIO(data), "text/csv")},
        data={"state_stamp": body["state_stamp"], "file_sha256": body["file_sha256"]},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Data changed since preview — run the preview again"
    assert db_session.query(Item).filter_by(title="Sneaky edit").count() == 1


def test_import_writes_snapshot_and_audit_names_it(client, db_session):
    client.post("/api/v1/items", json={"kind": "feature", "title": "Before"})
    resp = post_import(client, _csv(["After"]))
    assert resp.status_code == 200
    snapshot_dir = Path(os.environ["SNAPSHOT_DIR"])
    names = [p.name for p in snapshot_dir.iterdir()]
    assert len(names) == 1
    row = db_session.query(AuditEvent).filter_by(event_type="import.replaced").one()
    assert row.new_value == f"features=1 stories=0 risks=0 snapshot={names[0]}"
    import json as _json

    data = _json.loads((snapshot_dir / names[0]).read_text())
    assert data["counts"]["items"] == 1
    assert data["items"][0]["title"] == "Before"
```

- [ ] **Step 4: Update the existing import tests to the two-step flow.**
  - `backend/tests/test_import_endpoint.py`: add `from tests.import_helpers import post_import` and replace every
    `client.post("/api/v1/import", files={"file": (<name>, fh, "text/csv")})` with
    `post_import(client, fh.read(), <name>)` — keeping each `with FIXTURE.open("rb") as fh:` block (5 call sites; in `test_second_import_does_not_accumulate` the two results become `post_import(client, fh.read(), "p.csv").json()`).
  - `backend/tests/test_audit_links_import.py`: same replacement in `test_import_logs_exactly_one_summary_event`, and the `new_value` assertion becomes:

```python
    assert rows[0].new_value.startswith(
        f"features={body['features']} stories={body['stories']} risks={body['risks']} snapshot=import-snapshot-"
    )
```

- [ ] **Step 5: Run — expect the new file to FAIL** (preview 404; import 200 without guard fields).

- [ ] **Step 6: Implement** — replace `backend/app/routers/imports.py` entirely with:

```python
import hashlib

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.csv_import import parse_items, read_rows, replace_all
from app.db import get_db
from app.models import Comment, Item, ItemKind, ItemLink, User
from app.schemas import (
    ImportPreview,
    ImportPreviewCurrent,
    ImportPreviewIncoming,
    ImportResult,
)
from app.snapshots import compute_state_stamp, write_snapshot

router = APIRouter(prefix="/api/v1", tags=["import"])

TITLE_CAP = 20


async def _read_and_parse(file: UploadFile):
    content = await file.read()
    try:
        rows = read_rows(content)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"File is not valid UTF-8: {exc}")
    return content, parse_items(rows)


@router.post("/import/preview", response_model=ImportPreview)
async def preview_import(
    file: UploadFile,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> ImportPreview:
    content, parsed = await _read_and_parse(file)

    incoming_titles = {f.data["title"] for f in parsed.features}
    incoming_titles |= {s.data["title"] for f in parsed.features for s in f.stories}
    incoming_titles |= {r.data["title"] for r in parsed.risks}
    current_titles = set(db.scalars(select(Item.title)))
    added = sorted(incoming_titles - current_titles)
    removed = sorted(current_titles - incoming_titles)

    by_kind = dict(db.execute(select(Item.kind, func.count()).group_by(Item.kind)).all())
    return ImportPreview(
        file_sha256=hashlib.sha256(content).hexdigest(),
        state_stamp=compute_state_stamp(db),
        incoming=ImportPreviewIncoming(
            features=len(parsed.features),
            stories=sum(len(f.stories) for f in parsed.features),
            risks=len(parsed.risks),
            warnings=parsed.warnings,
        ),
        current=ImportPreviewCurrent(
            features=by_kind.get(ItemKind.FEATURE, 0),
            stories=by_kind.get(ItemKind.STORY, 0),
            risks=by_kind.get(ItemKind.RISK, 0),
            comments=db.scalar(select(func.count()).select_from(Comment)) or 0,
            links=db.scalar(select(func.count()).select_from(ItemLink)) or 0,
        ),
        added_titles=added[:TITLE_CAP],
        removed_titles=removed[:TITLE_CAP],
        added_more=max(0, len(added) - TITLE_CAP),
        removed_more=max(0, len(removed) - TITLE_CAP),
    )


@router.post("/import", response_model=ImportResult)
async def import_csv(
    file: UploadFile,
    state_stamp: str = Form(...),
    file_sha256: str = Form(...),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> ImportResult:
    content, parsed = await _read_and_parse(file)
    if hashlib.sha256(content).hexdigest() != file_sha256:
        raise HTTPException(
            status_code=400, detail="Uploaded file does not match the previewed file"
        )
    if compute_state_stamp(db) != state_stamp:
        raise HTTPException(
            status_code=409, detail="Data changed since preview — run the preview again"
        )
    try:
        snapshot_name = write_snapshot(db, actor=current.email)
    except OSError:
        raise HTTPException(
            status_code=500, detail="Snapshot could not be written — import aborted"
        )
    try:
        result = replace_all(db, parsed)
    except Exception as exc:  # roll back leaves existing data intact
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Import failed: {exc}")
    # Accepted gap: replace_all committed above, so a crash before the next
    # commit loses only this summary row — never the imported data.
    log_event(
        db,
        actor=current,
        event_type="import.replaced",
        entity_type="import",
        entity_label=file.filename,
        new_value=(
            f"features={result.features} stories={result.stories} "
            f"risks={result.risks} snapshot={snapshot_name}"
        ),
    )
    db.commit()
    return result
```

Note the sha check runs on raw bytes before the UTF-8 parse in spec order 1-2; `_read_and_parse` decodes first purely for code reuse — keep the spec's observable contract: a file that is both non-UTF-8 and sha-mismatched may return either 400; both details are 400-class. If the reviewer objects, inline the read and check sha before `read_rows`.

- [ ] **Step 7: Run the full backend suite — expect 179 passed** (172 + 7; updated files stay green).
- [ ] **Step 8: Commit** — `git add backend && git commit -m "feat(backend): import preview endpoint + confirm guards + pre-import snapshot"`

---

### Task 4: Snapshot list / download / restore endpoints

**Files:**
- Modify: `backend/app/snapshots.py` (add `restore_from_snapshot`), `backend/app/schemas.py` (after `ImportPreview`), `backend/app/routers/imports.py` (three endpoints)
- Test: `backend/tests/test_snapshot_restore.py` (new, 8 tests)

**Interfaces:**
- Consumes: Task 2 helpers, Task 3 `post_import`.
- Produces: `GET /api/v1/import/snapshots` → `{"snapshots": [...]}`; `GET /api/v1/import/snapshots/{name}/download` → file; `POST /api/v1/import/snapshots/{name}/restore` → `RestoreResult`.

- [ ] **Step 1: Add schemas** — in `backend/app/schemas.py`, after `ImportPreview`:

```python
class SnapshotInfo(BaseModel):
    name: str
    created_at: str
    actor: str
    items: int
    comments: int
    links: int


class SnapshotList(BaseModel):
    snapshots: list[SnapshotInfo]


class RestoreResult(BaseModel):
    items: int
    comments: int
    links: int
    warnings: list[str]
```

- [ ] **Step 2: Write the failing tests** — create `backend/tests/test_snapshot_restore.py`:

```python
import json
import os
from pathlib import Path

from sqlalchemy import select

from app.models import AuditEvent, Comment, Item, ItemKind, ItemLink, User
from app.snapshots import write_snapshot
from tests.import_helpers import post_import


def _dump(db):
    """Raw persisted rows for the three snapshot tables, keyed by id."""
    out = {}
    for model in (Item, Comment, ItemLink):
        table = model.__table__
        rows = db.execute(select(table).order_by(table.c.id)).mappings()
        out[table.name] = {row["id"]: dict(row) for row in rows}
    return out


def _seed_rich(db):
    author = User(email="author@x.local", display_name="A", password_hash=None, role="member")
    db.add(author)
    db.flush()
    f1 = Item(kind=ItemKind.FEATURE, title="F1", position=0)
    db.add(f1)
    db.flush()
    s1 = Item(kind=ItemKind.STORY, title="S1", parent_id=f1.id, position=0)
    db.add(s1)
    db.flush()
    f2 = Item(kind=ItemKind.FEATURE, title="F2", position=1)
    db.add(f2)
    db.flush()
    s1.parent_id = f2.id  # re-parented: parent_id > id
    top = Comment(item_id=f1.id, author_id=author.id, body="top")
    db.add(top)
    db.flush()
    db.add(Comment(item_id=f1.id, parent_id=top.id, author_id=author.id, body="reply"))
    db.add(ItemLink(source_id=f1.id, target_id=f2.id, relation="blocks"))
    db.commit()
    return author


def _wipe(db):
    db.query(Comment).delete()
    db.query(ItemLink).delete()
    db.query(Item).delete()
    db.commit()


def test_snapshot_endpoints_require_admin(member_client):
    assert member_client.get("/api/v1/import/snapshots").status_code == 403
    assert (
        member_client.get(
            "/api/v1/import/snapshots/import-snapshot-20260101T000000-000000Z.json/download"
        ).status_code
        == 403
    )
    assert (
        member_client.post(
            "/api/v1/import/snapshots/import-snapshot-20260101T000000-000000Z.json/restore"
        ).status_code
        == 403
    )


def test_list_snapshots_endpoint_shape_and_order(client, db_session):
    _seed_rich(db_session)
    first = write_snapshot(db_session, actor="one@x.local")
    second = write_snapshot(db_session, actor="two@x.local")
    body = client.get("/api/v1/import/snapshots").json()
    names = [s["name"] for s in body["snapshots"]]
    assert names == sorted([first, second], reverse=True)
    assert body["snapshots"][0]["items"] == 3
    assert body["snapshots"][0]["comments"] == 2
    assert body["snapshots"][0]["links"] == 1


def test_download_returns_snapshot_json(client, db_session):
    _seed_rich(db_session)
    name = write_snapshot(db_session, actor="a@x.local")
    resp = client.get(f"/api/v1/import/snapshots/{name}/download")
    assert resp.status_code == 200
    assert resp.json()["counts"]["items"] == 3
    assert name in resp.headers.get("content-disposition", "")


def test_download_unknown_or_invalid_name_404(client):
    for bad in ("nope.json", "import-snapshot-20990101T000000-000000Z.json"):
        resp = client.get(f"/api/v1/import/snapshots/{bad}/download")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Snapshot not found"


def test_restore_unknown_name_404(client):
    resp = client.post(
        "/api/v1/import/snapshots/import-snapshot-20990101T000000-000000Z.json/restore"
    )
    assert resp.status_code == 404


def test_restore_round_trip_preserves_rows_and_ids(client, db_session):
    _seed_rich(db_session)
    before = _dump(db_session)
    name = write_snapshot(db_session, actor="a@x.local")
    _wipe(db_session)
    assert _dump(db_session) == {"items": {}, "comments": {}, "item_links": {}}

    resp = client.post(f"/api/v1/import/snapshots/{name}/restore")
    assert resp.status_code == 200
    body = resp.json()
    assert (body["items"], body["comments"], body["links"]) == (3, 2, 1)
    assert body["warnings"] == []
    db_session.expire_all()
    assert _dump(db_session) == before


def test_restore_skips_orphan_author_comments_with_warnings(client, db_session):
    author = _seed_rich(db_session)
    name = write_snapshot(db_session, actor="a@x.local")
    _wipe(db_session)
    db_session.delete(author)
    db_session.commit()

    body = client.post(f"/api/v1/import/snapshots/{name}/restore").json()
    assert body["comments"] == 0
    assert body["warnings"] == [
        "Skipped 1 comment(s) whose author no longer exists",
        "Skipped 1 comment(s) whose parent comment was skipped",
    ]
    db_session.expire_all()
    assert db_session.query(Comment).count() == 0
    assert db_session.query(Item).count() == 3


def test_restore_writes_pre_restore_snapshot_and_audit(client, db_session):
    _seed_rich(db_session)
    name = write_snapshot(db_session, actor="a@x.local")
    snapshot_dir = Path(os.environ["SNAPSHOT_DIR"])
    count_before = len(list(snapshot_dir.iterdir()))

    resp = client.post(f"/api/v1/import/snapshots/{name}/restore")
    assert resp.status_code == 200
    assert len(list(snapshot_dir.iterdir())) == count_before + 1

    row = db_session.query(AuditEvent).filter_by(event_type="import.restored").one()
    assert row.entity_type == "import"
    assert row.entity_label == name
    assert row.new_value == "items=3 comments=2 links=1"
```

- [ ] **Step 3: Run — expect FAIL** (404s on the new routes).

- [ ] **Step 4: Implement restore in `backend/app/snapshots.py`** — append:

```python
def restore_from_snapshot(db: Session, data: dict) -> tuple[int, int, int, list[str]]:
    """Wholesale-replace items/comments/links from a snapshot payload.

    Explicit child-first deletes (no FK-cascade reliance — SQLite tests run
    without FK enforcement); original ids preserved via core inserts.
    """
    from sqlalchemy import DateTime, insert, text, update

    from app.models import User

    def _revive(model, row: dict) -> dict:
        out = {}
        for col in model.__table__.columns:
            value = row.get(col.name)
            if value is not None and isinstance(col.type, DateTime):
                value = datetime.fromisoformat(value)
            out[col.name] = value
        return out

    warnings: list[str] = []
    db.query(Comment).delete()
    db.query(ItemLink).delete()
    db.query(Item).delete()
    db.flush()

    item_rows = [_revive(Item, r) for r in data.get("items", [])]
    if item_rows:
        db.execute(insert(Item.__table__), [{**r, "parent_id": None} for r in item_rows])
        for row in item_rows:
            if row["parent_id"] is not None:
                db.execute(
                    update(Item.__table__)
                    .where(Item.__table__.c.id == row["id"])
                    .values(parent_id=row["parent_id"])
                )

    existing_users = set(db.scalars(select(User.id)))
    kept_ids: set[int] = set()
    kept_rows: list[dict] = []
    skipped_author = 0
    skipped_parent = 0
    for row in sorted(
        (_revive(Comment, r) for r in data.get("comments", [])), key=lambda r: r["id"]
    ):
        if row["author_id"] not in existing_users:
            skipped_author += 1
            continue
        if row["parent_id"] is not None and row["parent_id"] not in kept_ids:
            skipped_parent += 1
            continue
        kept_ids.add(row["id"])
        kept_rows.append(row)
    if kept_rows:
        db.execute(insert(Comment.__table__), kept_rows)
    if skipped_author:
        warnings.append(f"Skipped {skipped_author} comment(s) whose author no longer exists")
    if skipped_parent:
        warnings.append(f"Skipped {skipped_parent} comment(s) whose parent comment was skipped")

    link_rows = [_revive(ItemLink, r) for r in data.get("links", [])]
    if link_rows:
        db.execute(insert(ItemLink.__table__), link_rows)

    if db.get_bind().dialect.name == "postgresql":
        for table in ("items", "comments", "item_links"):
            db.execute(
                text(
                    f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {table}), 1))"
                )
            )

    return len(item_rows), len(kept_rows), len(link_rows), warnings
```

- [ ] **Step 5: Add the endpoints** — in `backend/app/routers/imports.py`:
  - extend the imports: `import json` (top, after `import hashlib`), `from fastapi.responses import FileResponse`, add `SnapshotInfo, SnapshotList, RestoreResult` to the `app.schemas` import, and add `list_snapshots, restore_from_snapshot, snapshot_path` to the `app.snapshots` import.
  - append after `import_csv`:

```python
@router.get("/import/snapshots", response_model=SnapshotList)
def get_snapshots(current: User = Depends(require_admin)) -> SnapshotList:
    return SnapshotList(snapshots=[SnapshotInfo(**s) for s in list_snapshots()])


@router.get("/import/snapshots/{name}/download")
def download_snapshot(name: str, current: User = Depends(require_admin)) -> FileResponse:
    path = snapshot_path(name)
    if path is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return FileResponse(path, media_type="application/json", filename=name)


@router.post("/import/snapshots/{name}/restore", response_model=RestoreResult)
def restore_snapshot(
    name: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> RestoreResult:
    path = snapshot_path(name)
    if path is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    data = json.loads(path.read_text())
    write_snapshot(db, actor=current.email)  # restores are undoable too
    try:
        items, comments, links, warnings = restore_from_snapshot(db, data)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Restore failed: {exc}")
    log_event(
        db,
        actor=current,
        event_type="import.restored",
        entity_type="import",
        entity_label=name,
        new_value=f"items={items} comments={comments} links={links}",
    )
    db.commit()
    return RestoreResult(items=items, comments=comments, links=links, warnings=warnings)
```

- [ ] **Step 6: Run the full backend suite — expect 187 passed** (179 + 8).
- [ ] **Step 7: Commit** — `git add backend && git commit -m "feat(backend): snapshot list/download/restore endpoints"`

---

### Task 5: Frontend types + client functions

**Files:**
- Modify: `frontend/src/types.ts` (after `ImportResult`), `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: `previewImport(file)`, `importCsv(file, stateStamp, fileSha256)`, `listSnapshots()`, `restoreSnapshot(name)`; types `ImportPreview`, `SnapshotInfo`, `RestoreResult`.

- [ ] **Step 1: Add types** — in `frontend/src/types.ts`, after the `ImportResult` interface:

```ts
export interface ImportPreview {
  file_sha256: string;
  state_stamp: string;
  incoming: { features: number; stories: number; risks: number; warnings: string[] };
  current: { features: number; stories: number; risks: number; comments: number; links: number };
  added_titles: string[];
  removed_titles: string[];
  added_more: number;
  removed_more: number;
}

export interface SnapshotInfo {
  name: string;
  created_at: string;
  actor: string;
  items: number;
  comments: number;
  links: number;
}

export interface RestoreResult {
  items: number;
  comments: number;
  links: number;
  warnings: string[];
}
```

- [ ] **Step 2: Update the failing tests first** — in `frontend/src/api/client.test.ts`, replace the existing `importCsv posts multipart form data` test with, and add after it:

```ts
  it("importCsv posts multipart form data with the preview guards", async () => {
    const spy = mockFetch(200, { features: 1, stories: 0, risks: 0, warnings: [] });
    const file = new File(["Title\nX"], "p.csv", { type: "text/csv" });
    const result = await importCsv(file, "stamp123", "sha456");
    expect(result.features).toBe(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/import");
    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("state_stamp")).toBe("stamp123");
    expect(body.get("file_sha256")).toBe("sha456");
  });

  it("previewImport posts the file to /api/v1/import/preview", async () => {
    const spy = mockFetch(200, {
      file_sha256: "s", state_stamp: "t",
      incoming: { features: 1, stories: 2, risks: 0, warnings: [] },
      current: { features: 0, stories: 0, risks: 0, comments: 0, links: 0 },
      added_titles: [], removed_titles: [], added_more: 0, removed_more: 0,
    });
    const file = new File(["Title\nX"], "p.csv", { type: "text/csv" });
    const preview = await previewImport(file);
    expect(preview.state_stamp).toBe("t");
    expect(spy.mock.calls[0][0]).toBe("/api/v1/import/preview");
    expect(spy.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  it("listSnapshots unwraps the snapshots array", async () => {
    const spy = mockFetch(200, {
      snapshots: [{ name: "import-snapshot-20260702T120000-000000Z.json", created_at: "c", actor: "a", items: 1, comments: 0, links: 0 }],
    });
    const list = await listSnapshots();
    expect(spy).toHaveBeenCalledWith("/api/v1/import/snapshots", undefined);
    expect(list).toHaveLength(1);
    expect(list[0].items).toBe(1);
  });

  it("restoreSnapshot posts to the restore route", async () => {
    const spy = mockFetch(200, { items: 3, comments: 2, links: 1, warnings: [] });
    const result = await restoreSnapshot("import-snapshot-20260702T120000-000000Z.json");
    expect(result.items).toBe(3);
    expect(spy.mock.calls[0][0]).toBe(
      "/api/v1/import/snapshots/import-snapshot-20260702T120000-000000Z.json/restore",
    );
    expect(spy.mock.calls[0][1]?.method).toBe("POST");
  });
```

Extend the client import line at the top of the file with `listSnapshots, previewImport, restoreSnapshot` (alphabetical within the braces).

- [ ] **Step 3: Run — expect FAIL** (`previewImport` not exported; importCsv arity).

- [ ] **Step 4: Implement** — in `frontend/src/api/client.ts`:
  - Add `ImportPreview, RestoreResult, SnapshotInfo` to the `../types` type import.
  - Replace the `importCsv` function with:

```ts
export function previewImport(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  return request<ImportPreview>(`${API}/import/preview`, { method: "POST", body: form });
}

export function importCsv(file: File, stateStamp: string, fileSha256: string): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("state_stamp", stateStamp);
  form.append("file_sha256", fileSha256);
  return request<ImportResult>(`${API}/import`, { method: "POST", body: form });
}

export function listSnapshots(): Promise<SnapshotInfo[]> {
  return request<{ snapshots: SnapshotInfo[] }>(`${API}/import/snapshots`).then((r) => r.snapshots);
}

export function restoreSnapshot(name: string): Promise<RestoreResult> {
  return request<RestoreResult>(`${API}/import/snapshots/${encodeURIComponent(name)}/restore`, {
    method: "POST",
  });
}
```

  - `ImportButton.tsx` still calls `importCsv(file)`, which no longer typechecks. Task 5 ships green with a temporary shim: change its call to `await importCsv(file, "", "")` (Task 6 replaces this whole flow with the preview modal) and change the first ImportButton test's `expect(importSpy).toHaveBeenCalledWith(file)` to `toHaveBeenCalledWith(file, "", "")`. Task 6 deletes both shims.

- [ ] **Step 5: Run** `npx vitest run` **and** `npx tsc --noEmit` **— expect 184 passed** (181 + 3 net: 3 new client tests, importCsv test replaced in place) **and clean tsc.**
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(frontend): import preview/snapshot/restore client functions"`

---

### Task 6: ImportButton preview modal

**Files:**
- Rewrite: `frontend/src/components/ImportButton.tsx`
- Rewrite: `frontend/src/components/ImportButton.test.tsx` (2 tests → 6)

**Interfaces:**
- Consumes: `previewImport`, `importCsv(file, stamp, sha)`, `ConflictError` from client; `ImportPreview` type.
- Produces: same component API (`onImported`), now with the modal flow.

- [ ] **Step 1: Rewrite the tests** — replace `frontend/src/components/ImportButton.test.tsx` entirely:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { ConflictError } from "../api/client";
import type { ImportPreview } from "../types";
import ImportButton from "./ImportButton";

afterEach(() => vi.restoreAllMocks());

const PREVIEW: ImportPreview = {
  file_sha256: "sha456",
  state_stamp: "stamp123",
  incoming: { features: 40, stories: 60, risks: 8, warnings: ["Row 2: odd"] },
  current: { features: 3, stories: 5, risks: 1, comments: 7, links: 2 },
  added_titles: ["New thing"],
  removed_titles: ["Old thing"],
  added_more: 0,
  removed_more: 4,
};

function mockPreview(preview: ImportPreview = PREVIEW) {
  return vi.spyOn(client, "previewImport").mockResolvedValue(preview);
}

async function openModal() {
  const file = new File(["Title\nX"], "plan.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText(/import csv/i), file);
  return file;
}

it("shows the preview modal with delete and import counts", async () => {
  mockPreview();
  render(<ImportButton onImported={() => {}} />);
  await openModal();
  expect(await screen.findByText("Replace all data from CSV?")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Will be deleted: 3 features, 5 stories, 1 risks — plus 7 comments and 2 links (not recoverable from CSV)",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("Will be imported: 40 features, 60 stories, 8 risks")).toBeInTheDocument();
  expect(screen.getByText("A snapshot is saved automatically before the import.")).toBeInTheDocument();
});

it("renders warnings and capped title diffs", async () => {
  mockPreview();
  render(<ImportButton onImported={() => {}} />);
  await openModal();
  expect(await screen.findByText("Row 2: odd")).toBeInTheDocument();
  expect(screen.getByText(/New thing/)).toBeInTheDocument();
  expect(screen.getByText(/Old thing … and 4 more/)).toBeInTheDocument();
});

it("cancel closes the modal without importing", async () => {
  mockPreview();
  const importSpy = vi.spyOn(client, "importCsv");
  render(<ImportButton onImported={() => {}} />);
  await openModal();
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(importSpy).not.toHaveBeenCalled();
  expect(screen.queryByText("Replace all data from CSV?")).not.toBeInTheDocument();
});

it("confirm sends the guards and reports counts", async () => {
  mockPreview();
  const importSpy = vi.spyOn(client, "importCsv").mockResolvedValue({
    features: 40, stories: 60, risks: 8, warnings: ["w1"],
  });
  const onImported = vi.fn();
  render(<ImportButton onImported={onImported} />);
  const file = await openModal();
  await userEvent.click(await screen.findByRole("button", { name: "Replace all data" }));
  expect(importSpy).toHaveBeenCalledWith(file, "stamp123", "sha456");
  expect(onImported).toHaveBeenCalled();
  expect(await screen.findByText(/40 features/i)).toBeInTheDocument();
  expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
  expect(screen.queryByText("Replace all data from CSV?")).not.toBeInTheDocument();
});

it("shows the conflict detail inside the modal on 409", async () => {
  mockPreview();
  vi.spyOn(client, "importCsv").mockRejectedValue(
    new ConflictError("Data changed since preview — run the preview again"),
  );
  render(<ImportButton onImported={() => {}} />);
  await openModal();
  await userEvent.click(await screen.findByRole("button", { name: "Replace all data" }));
  expect(
    await screen.findByText("Data changed since preview — run the preview again"),
  ).toBeInTheDocument();
  expect(screen.getByText("Replace all data from CSV?")).toBeInTheDocument();
});

it("reports preview failures in the status line", async () => {
  vi.spyOn(client, "previewImport").mockRejectedValue(new Error("400 Bad Request: nope"));
  render(<ImportButton onImported={() => {}} />);
  await openModal();
  expect(await screen.findByText(/Import failed: 400 Bad Request/)).toBeInTheDocument();
  expect(screen.queryByText("Replace all data from CSV?")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run — expect FAIL** (component still uses window.confirm).

- [ ] **Step 3: Rewrite the component** — replace `frontend/src/components/ImportButton.tsx` entirely:

```tsx
import { useRef, useState } from "react";
import { ConflictError, importCsv, previewImport } from "../api/client";
import type { ImportPreview, ImportResult } from "../types";

export default function ImportButton({
  onImported,
}: {
  onImported: (result: ImportResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = "";
    if (!chosen) return;
    setStatus(null);
    try {
      const p = await previewImport(chosen);
      setFile(chosen);
      setPreview(p);
      setModalError(null);
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const close = () => {
    setPreview(null);
    setFile(null);
    setModalError(null);
  };

  const confirm = async () => {
    if (!file || !preview) return;
    setBusy(true);
    setModalError(null);
    try {
      const result = await importCsv(file, preview.state_stamp, preview.file_sha256);
      close();
      setStatus(
        `Imported ${result.features} features, ${result.stories} stories, ` +
          `${result.risks} risks` +
          (result.warnings.length ? ` — ${result.warnings.length} warning(s)` : ""),
      );
      onImported(result);
    } catch (err) {
      if (err instanceof ConflictError) {
        setModalError(err.detail);
      } else {
        close();
        setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const titleLine = (list: string[], more: number) =>
    list.length ? list.join(", ") + (more > 0 ? ` … and ${more} more` : "") : null;

  return (
    <div className="flex items-center gap-3">
      <label className="cursor-pointer rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700">
        Import CSV
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          aria-label="Import CSV"
          onChange={onFile}
          className="hidden"
        />
      </label>
      {status && <span className="text-xs text-gray-500">{status}</span>}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          role="dialog"
          aria-label="Import preview"
        >
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900">Replace all data from CSV?</h2>
            <p className="mt-3 text-sm text-gray-700">
              {`Will be deleted: ${preview.current.features} features, ${preview.current.stories} stories, ` +
                `${preview.current.risks} risks — plus ${preview.current.comments} comments and ` +
                `${preview.current.links} links (not recoverable from CSV)`}
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {`Will be imported: ${preview.incoming.features} features, ` +
                `${preview.incoming.stories} stories, ${preview.incoming.risks} risks`}
            </p>
            {preview.incoming.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
                {preview.incoming.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {titleLine(preview.added_titles, preview.added_more) && (
              <p className="mt-2 text-xs text-gray-500">
                <span className="font-medium text-gray-700">Added: </span>
                {titleLine(preview.added_titles, preview.added_more)}
              </p>
            )}
            {titleLine(preview.removed_titles, preview.removed_more) && (
              <p className="mt-1 text-xs text-gray-500">
                <span className="font-medium text-gray-700">Removed: </span>
                {titleLine(preview.removed_titles, preview.removed_more)}
              </p>
            )}
            <p className="mt-3 text-xs text-gray-500">
              A snapshot is saved automatically before the import.
            </p>
            {modalError && <p className="mt-2 text-xs font-medium text-amber-700">{modalError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={close}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={busy}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                Replace all data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run** `npx vitest run` **and** `npx tsc --noEmit` **— expect 188 passed** (184 − 2 old + 6 new) **and clean tsc.** The "Removed:" test asserts `Old thing … and 4 more` — the removed list joins then appends the ellipsis suffix.
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "feat(frontend): import preview modal replaces blind confirm"`

---

### Task 7: SnapshotsSection on the Admin page

**Files:**
- Create: `frontend/src/components/admin/SnapshotsSection.tsx`
- Create: `frontend/src/components/admin/SnapshotsSection.test.tsx` (4 tests)
- Modify: `frontend/src/components/admin/AdminView.tsx`
- Possibly modify: `frontend/src/components/admin/AdminView.test.tsx` (add `listSnapshots` mock if it renders children un-mocked; test count unchanged)

**Interfaces:**
- Consumes: `listSnapshots`, `restoreSnapshot`, `API` from client; `SnapshotInfo`, `RestoreResult` types; `AdminCard` + `adminEmptyClass`.
- Produces: `<SnapshotsSection onChanged={...} />` rendered last in AdminView.

- [ ] **Step 1: Write the failing tests** — create `frontend/src/components/admin/SnapshotsSection.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { SnapshotInfo } from "../../types";
import SnapshotsSection from "./SnapshotsSection";

afterEach(() => vi.restoreAllMocks());

const SNAP: SnapshotInfo = {
  name: "import-snapshot-20260702T120000-000000Z.json",
  created_at: "2026-07-02T12:00:00+00:00",
  actor: "admin@example.com",
  items: 131,
  comments: 12,
  links: 5,
};

it("renders snapshot rows with counts and a download link", async () => {
  vi.spyOn(client, "listSnapshots").mockResolvedValue([SNAP]);
  render(<SnapshotsSection onChanged={() => {}} />);
  expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
  expect(screen.getByText("131")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Download" });
  expect(link).toHaveAttribute(
    "href",
    "/api/v1/import/snapshots/import-snapshot-20260702T120000-000000Z.json/download",
  );
});

it("shows the empty state", async () => {
  vi.spyOn(client, "listSnapshots").mockResolvedValue([]);
  render(<SnapshotsSection onChanged={() => {}} />);
  expect(
    await screen.findByText("No snapshots yet — one is created automatically before every import."),
  ).toBeInTheDocument();
});

it("declined confirm does not restore", async () => {
  vi.spyOn(client, "listSnapshots").mockResolvedValue([SNAP]);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const restoreSpy = vi.spyOn(client, "restoreSnapshot");
  render(<SnapshotsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /restore snapshot/i }));
  expect(restoreSpy).not.toHaveBeenCalled();
});

it("confirmed restore reports counts and reloads the list", async () => {
  const listSpy = vi.spyOn(client, "listSnapshots").mockResolvedValue([SNAP]);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(client, "restoreSnapshot").mockResolvedValue({
    items: 131, comments: 12, links: 5, warnings: ["one"],
  });
  const onChanged = vi.fn();
  render(<SnapshotsSection onChanged={onChanged} />);
  await userEvent.click(await screen.findByRole("button", { name: /restore snapshot/i }));
  expect(
    await screen.findByText("Restored 131 items, 12 comments, 5 links — 1 warning(s)"),
  ).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalled();
  await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).

- [ ] **Step 3: Implement** — create `frontend/src/components/admin/SnapshotsSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { API, listSnapshots, restoreSnapshot } from "../../api/client";
import type { SnapshotInfo } from "../../types";
import AdminCard, { adminEmptyClass } from "./AdminCard";

export default function SnapshotsSection({ onChanged }: { onChanged: () => void }) {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => void listSnapshots().then(setSnapshots);
  useEffect(reload, []);

  const restore = async (name: string) => {
    if (!window.confirm(`Restore snapshot ${name}? Current data is snapshotted first, then replaced.`)) {
      return;
    }
    setError(null);
    setStatus(null);
    try {
      const r = await restoreSnapshot(name);
      setStatus(
        `Restored ${r.items} items, ${r.comments} comments, ${r.links} links` +
          (r.warnings.length ? ` — ${r.warnings.length} warning(s)` : ""),
      );
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore the snapshot.");
    }
  };

  return (
    <AdminCard
      title="Import snapshots"
      icon="🗂️"
      accent="bg-emerald-50 text-emerald-600"
      count={snapshots.length}
    >
      {status && <p className="mb-2 text-xs text-emerald-700">{status}</p>}
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      {snapshots.length === 0 ? (
        <p className={adminEmptyClass}>
          No snapshots yet — one is created automatically before every import.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-700">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 pr-3 font-medium">By</th>
                <th className="py-2 pr-3 font-medium">Items</th>
                <th className="py-2 pr-3 font-medium">Comments</th>
                <th className="py-2 pr-3 font-medium">Links</th>
                <th className="py-2 font-medium" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.name} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-3">{new Date(s.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-3">{s.actor}</td>
                  <td className="py-2 pr-3">{s.items}</td>
                  <td className="py-2 pr-3">{s.comments}</td>
                  <td className="py-2 pr-3">{s.links}</td>
                  <td className="py-2">
                    <span className="flex items-center justify-end gap-3">
                      <a
                        href={`${API}/import/snapshots/${encodeURIComponent(s.name)}/download`}
                        download={s.name}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Download
                      </a>
                      <button
                        onClick={() => restore(s.name)}
                        aria-label={`restore snapshot ${s.name}`}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Restore
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}
```

- [ ] **Step 4: Wire into AdminView** — in `frontend/src/components/admin/AdminView.tsx`, add the import `import SnapshotsSection from "./SnapshotsSection";` (alphabetical among the section imports) and, after the CapacitySection block, add:

```tsx
      <div className="mt-4">
        <SnapshotsSection onChanged={onChanged} />
      </div>
```

If `AdminView.test.tsx` renders AdminView with un-mocked children, add `listSnapshots: vi.fn().mockResolvedValue([])` to its client mocks the same way the other sections' fetchers are mocked there.

- [ ] **Step 5: Run** `npx vitest run` **and** `npx tsc --noEmit` **— expect 192 passed** (188 + 4) **and clean tsc.**
- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(frontend): admin import-snapshots section with restore"`

---

### Task 8: Compose volume, deploy, smoke

**Files:**
- Modify: `docker-compose.yml` (backend volumes + top-level volume)

**Interfaces:**
- Consumes: everything above at branch HEAD.
- Produces: running stack on the new images with a persistent `/app/snapshots` volume.

- [ ] **Step 1: Add the volume** — in `docker-compose.yml`, add to the `backend:` service (after `environment:`, aligned with its siblings):

```yaml
    volumes:
      - snapshots:/app/snapshots
```

and extend the top-level volumes block:

```yaml
volumes:
  pgdata:
  snapshots:
```

- [ ] **Step 2: Rebuild and start** — `docker compose up -d --build backend frontend` (wait for healthy).

- [ ] **Step 3: Full-suite verification at HEAD** — backend via the ENV protocol (expect **187 passed**), frontend `npx vitest run` (expect **192 passed**) + `npx tsc --noEmit` clean.

- [ ] **Step 4: curl smoke (safe — never confirm an import against live data):**

```bash
# login (compose default admin) and keep the session cookie
curl -s -c /tmp/kb.jar -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin"}' | head -c 200
# snapshots list (expect {"snapshots":[]} on a fresh volume)
curl -s -b /tmp/kb.jar http://localhost:8080/api/v1/import/snapshots
# dry-run preview with a scratch CSV — writes nothing
printf 'Title,Type\nScratch,Feature\n' > /tmp/scratch.csv
curl -s -b /tmp/kb.jar -F file=@/tmp/scratch.csv http://localhost:8080/api/v1/import/preview
# expect JSON with file_sha256, 16-char state_stamp, current counts of the real DB
# verify volume exists and stays empty (no snapshot from previews)
docker compose exec -T backend ls -la /app/snapshots
```

DO NOT POST `/api/v1/import` against the live stack — it would replace Marco's real data.

- [ ] **Step 5: Report status DONE with the curl outputs.** The controller performs the browser verification (Admin page section, preview modal on the real DB, then Cancel).

- [ ] **Step 6: Commit** — `git add docker-compose.yml && git commit -m "chore: snapshots volume for import safety"`
