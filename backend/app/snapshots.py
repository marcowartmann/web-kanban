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
        try:
            data = json.loads((directory / name).read_text())
        except (ValueError, OSError):
            continue
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


def restore_from_snapshot(db: Session, data: dict) -> tuple[int, int, int, list[str]]:
    """Wholesale-replace items/comments/links from a snapshot payload.

    Explicit child-first deletes (no FK-cascade reliance — SQLite tests run
    without FK enforcement); original ids preserved via core inserts.
    """
    from sqlalchemy import insert, text, update

    from app.models import User
    from app.timeutil import DateTime

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
                    .values(parent_id=row["parent_id"], updated_at=row["updated_at"])
                )

    existing_users = set(db.scalars(select(User.id)))
    kept_ids: set[int] = set()
    kept_rows: list[dict] = []
    skipped_author = 0
    skipped_parent = 0
    for row in sorted(
        (_revive(Comment, r) for r in data.get("comments", [])), key=lambda r: r["id"]
    ):
        # Parent-skip is checked first: once a thread's root is dropped for an
        # invalid author, every descendant is attributed to the cascade (not
        # re-counted under "author") even when it independently shares that
        # same missing author.
        if row["parent_id"] is not None and row["parent_id"] not in kept_ids:
            skipped_parent += 1
            continue
        if row["author_id"] not in existing_users:
            skipped_author += 1
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
