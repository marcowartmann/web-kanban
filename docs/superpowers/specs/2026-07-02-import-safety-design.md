# Import Safety (dry-run preview, pre-import snapshot, restore) — Design

**Date:** 2026-07-02
**Status:** Approved (design); pending spec review
**Context:** P3 of the enterprise-hardening package (P1 reference integrity merged 839de24;
P2 concurrency + /api/v1 + pagination merged b2e7ccc; P4 timestamps + observability follows).

## Problem

`POST /api/v1/import` wholesale-replaces the dataset after a blind `window.confirm`.
`replace_all` runs `db.query(Item).delete()`, which cascades to **comments and links —
data the CSV cannot represent** — so one wrong file destroys them permanently. There is
no export, no preview of what a file would do, and an import silently clobbers anything
other users edited between opening the dialog and confirming (P2 final-review roadmap
note). The user chose the **full loop**: preview + automatic snapshot + self-service
restore.

## 1. Dry-run preview

**New `POST /api/v1/import/preview`** (admin, multipart `file`): parses the CSV with the
existing `read_rows` + `parse_items`, **writes nothing** (no DB mutation, no audit row,
no snapshot), and returns:

```python
class ImportPreviewIncoming(BaseModel):
    features: int
    stories: int
    risks: int
    warnings: list[str]          # parser warnings, verbatim

class ImportPreviewCurrent(BaseModel):
    features: int
    stories: int
    risks: int
    comments: int
    links: int

class ImportPreview(BaseModel):
    file_sha256: str             # full sha256 hexdigest of the uploaded bytes
    state_stamp: str             # fingerprint of current DB data (below)
    incoming: ImportPreviewIncoming
    current: ImportPreviewCurrent
    added_titles: list[str]      # sorted(set(incoming titles) - set(current titles))[:20]
    removed_titles: list[str]    # sorted(set(current titles) - set(incoming titles))[:20]
    added_more: int              # count beyond the 20-title cap (0 if none)
    removed_more: int
```

Titles compare as exact strings across all kinds; the lists are indicative (titles are
not unique). Invalid UTF-8 → 400 exactly as the import endpoint does today.

**State stamp (binding):** `sha256(f"{ic}:{im}:{iv}:{cc}:{cm}:{lc}:{lm}".encode()).hexdigest()[:16]`
where `ic/im/iv` = count(items), coalesce(max(items.id),0), coalesce(sum(items.version),0)
and `cc/cm` / `lc/lm` = count and coalesce(max(id),0) of comments / item_links. Any item
create/edit/delete, comment add/delete, or link add/delete changes the stamp. Known blind
spot (accepted, documented): editing a comment's *body* does not move the stamp — comments
are wholesale-deleted either way and the previewed counts stay true.

## 2. Confirm-only import

`POST /api/v1/import` gains two **required** multipart form fields: `state_stamp: str`
and `file_sha256: str` (missing → 422; the frontend is the only consumer — v1 evolves in
lockstep per the documented policy). Order of checks:

1. Read bytes; `sha256(bytes) != file_sha256` → **400** `"Uploaded file does not match the previewed file"`.
2. Decode/parse (existing 400 on invalid UTF-8).
3. Recompute the state stamp; mismatch → **409** `"Data changed since preview — run the preview again"`.
4. Write the pre-import snapshot (section 3); failure → **500** `"Snapshot could not be written — import aborted"` (the seatbelt is mandatory), nothing deleted.
5. `replace_all` as today.
6. Audit `import.replaced` `new_value` becomes
   `f"features={r.features} stories={r.stories} risks={r.risks} snapshot={filename}"`.

The stamp is recomputed inside the confirm request immediately before the snapshot +
delete, shrinking the destructive race from the whole preview-to-confirm window to
microseconds (residual TOCTOU accepted; imports are rare admin operations).

## 3. Automatic pre-import snapshot

**New module `backend/app/snapshots.py`.** Snapshot directory comes from
`SNAPSHOT_DIR` env var, default `/app/snapshots`, **read at call time** (a function,
not a module-level constant — tests point it at `tmp_path` via `monkeypatch.setenv`).

**Filename (binding):** `import-snapshot-{UTC:%Y%m%dT%H%M%S}-{microsecond:06d}Z.json`,
e.g. `import-snapshot-20260702T214500-123456Z.json`, validated everywhere by
`^import-snapshot-\d{8}T\d{6}-\d{6}Z\.json$` (also the path-traversal guard: names not
matching → 404).

**Format:**

```json
{
  "schema": 1,
  "created_at": "2026-07-02T21:45:00+00:00",
  "actor": "admin@example.com",
  "counts": {"items": 131, "comments": 12, "links": 5},
  "items":    [ {"id": 1, "kind": "...", ...every column...} ],
  "comments": [ {"id": 1, "item_id": 1, ...} ],
  "links":    [ {"id": 1, "source_id": 1, ...} ]
}
```

**Serialization (binding):** generic column walk — rows come from **core**
`db.execute(select(Model.__table__))` so values are the raw persisted forms (enum
strings pass through untransformed); `datetime` → `.isoformat()`, `Decimal` → `float`,
everything else as-is. No hand-maintained field list: future columns are included
automatically. Tables: `items`, `comments`, `item_links` (ordered by id).

**Retention:** after a successful write, keep the **newest 20** by name sort (names are
sortable), unlink the rest.

**Infra:** compose adds a named volume `snapshots:` mounted at `/app/snapshots` on the
backend service.

## 4. Snapshot listing, download, restore

All admin-only, on the imports router:

- **`GET /api/v1/import/snapshots`** → `{"snapshots": [SnapshotInfo, ...]}` newest
  first; `SnapshotInfo {name, created_at, actor, items, comments, links}` read from each
  file's header (counts object).
- **`GET /api/v1/import/snapshots/{name}/download`** → `FileResponse`
  (`application/json`, download filename = name). Invalid pattern or missing file →
  **404** `"Snapshot not found"`.
- **`POST /api/v1/import/snapshots/{name}/restore`** → `RestoreResult {items: int,
  comments: int, links: int, warnings: list[str]}`; 404 as above. Steps:
  1. Load and validate the snapshot JSON.
  2. **Write a fresh snapshot of the current state first** (restores are undoable).
  3. Delete all items (cascade wipes comments/links), then re-insert **with original
     ids** via core `insert(Model.__table__)` (ISO strings → `datetime.fromisoformat`
     for DateTime columns, None-safe).
     - Items in two passes: insert every row with `parent_id=None`, then bulk-update
       `parent_id` for parented rows (re-parenting via PATCH means `parent_id > id` is
       possible — id-ordered single-pass insert would violate the FK).
     - Comments in id order, keeping a comment only if its `author_id` still exists in
       `users` AND (`parent_id` is null or its parent was kept); skips produce at most
       two summary warnings, each emitted only when its count > 0:
       `f"Skipped {n} comment(s) whose author no longer exists"` and
       `f"Skipped {n} comment(s) whose parent comment was skipped"`.
     - Links inserted directly (both endpoints exist by construction).
  4. On Postgres only: `SELECT setval(pg_get_serial_sequence('<table>', 'id'),
     COALESCE((SELECT MAX(id) FROM <table>), 1))` for items, comments, item_links
     (SQLite tests need nothing).
  5. Audit `import.restored`, `entity_type="import"`, `entity_label=<name>`,
     `new_value=f"items={i} comments={c} links={l}"`; commit.

Restore takes no state stamp (it is an explicit recovery action and pre-snapshots
itself); the UI guards it with a confirm.

## 5. Fold-in from the P2 final review

`delete_item` (and by extension its child cascade) now runs under the version predicate
(`version_id_col`): a concurrent edit landing between its SELECT and DELETE raises an
unhandled `StaleDataError` → 500 today. Wrap its commit exactly like `update_item`:
`StaleDataError` → rollback → **409** `"Item was modified by someone else — reload and
retry"` (same detail string; the client's `ConflictError` already handles it).

## 6. Frontend

**types.ts:** `ImportPreview`, `SnapshotInfo`, `RestoreResult` mirroring the schemas
above (`ImportResult` unchanged).

**client.ts:**
- `previewImport(file: File): Promise<ImportPreview>` → POST `${API}/import/preview`.
- `importCsv(file: File, stateStamp: string, fileSha256: string): Promise<ImportResult>`
  — appends form fields `state_stamp`, `file_sha256` (breaking signature change; update
  callers/tests).
- `listSnapshots(): Promise<SnapshotInfo[]>` (unwraps `.snapshots`),
  `restoreSnapshot(name: string): Promise<RestoreResult>`.
- Download needs no fn — same-origin anchor:
  `href={`${API}/import/snapshots/${name}/download`}` with the `download` attribute.

**ImportButton** (replaces `window.confirm`): file pick → `previewImport` → modal:
- Title: **"Replace all data from CSV?"**
- `Will be deleted: ${current.features} features, ${current.stories} stories, ${current.risks} risks — plus ${current.comments} comments and ${current.links} links (not recoverable from CSV)`
- `Will be imported: ${incoming.features} features, ${incoming.stories} stories, ${incoming.risks} risks`
- Parser warnings listed (amber), then added/removed title lists, each capped with
  `… and ${n} more` when `*_more > 0`.
- Note line: `A snapshot is saved automatically before the import.`
- Buttons: **Cancel** / **Replace all data** (red, `bg-red-600 text-white`).
- Confirm calls `importCsv(file, preview.state_stamp, preview.file_sha256)`; success
  keeps today's status line; `ConflictError` shows its `.detail` inside the modal;
  other errors keep the `Import failed: …` status.

**Admin page — new "Import snapshots" section** (`SnapshotsSection.tsx`, styled like
the existing admin sections): table Created / By / Items / Comments / Links / actions
(Download link, Restore button). Restore →
`window.confirm(`Restore snapshot ${name}? Current data is snapshotted first, then replaced.`)`
→ on success show `Restored ${items} items, ${comments} comments, ${links} links`
(+ warning count if any) and reload the list (the pre-restore snapshot appears). Empty
state: `No snapshots yet — one is created automatically before every import.`

## Testing

**Backend:** preview returns counts/stamp/sha and writes nothing (items, audit-row count
unchanged); title diff lists + caps; confirm without the new fields → 422; sha mismatch
→ 400; stamp mismatch (mutate an item between preview and confirm) → 409 with the exact
detail; happy path writes a snapshot containing items + comments + links and the audit
value names it; retention prunes to 20; list/download/restore 404 on traversal-style and
unknown names; **round-trip**: seed items (including a `parent_id > id` re-parent case),
comments (including a reply), a link → import different data → restore → deep-equal
original rows with original ids; orphan-author comment and its reply skipped with
warnings; restore writes a pre-restore snapshot; delete-race → 409 (core version bump
then DELETE, mirroring the P2 race test).

**Frontend:** client fns hit the right URLs with the right payloads; ImportButton:
preview opens the modal with the exact copy, cancel sends nothing, confirm sends
stamp + sha, 409 shows the conflict detail; SnapshotsSection: renders rows, declined
confirm sends nothing, restore success line, empty state.

Suite baselines at spec time: backend 166, frontend 181 (exact counts pinned at plan
time).

## Scope guards (v1)

- Still a wholesale replace — no merge/partial/per-row import.
- Import-triggered snapshots only — no scheduled backups, no pg_dump (slim image).
- Restore covers items/comments/links only — users, teams, members, planning intervals,
  boards, capacities, and audit history are untouched.
- No stamp on restore; no snapshot delete endpoint (retention handles growth).
- Snapshot files are trusted admin artifacts — no schema-version migration machinery
  beyond the `"schema": 1` marker.
