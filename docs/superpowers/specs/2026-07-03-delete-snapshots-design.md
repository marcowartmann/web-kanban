# Delete snapshots (guard the newest) — Design

**Date:** 2026-07-03
**Status:** Approved (design gate) — pending spec review

## Context

Snapshots can be created (manually and automatically), listed, downloaded, and
restored, but not deleted. The user wants to delete them with a guard. A
snapshot file is referenced by nothing, so the guard protects the **newest**
snapshot — the freshest restore point — via the established 409/force pattern.
Because the only snapshot is also the newest, this covers the last-remaining
case too.

## Backend

### `backend/app/snapshots.py`

```python
def newest_snapshot_name() -> str | None:
    directory = _snapshot_dir()
    if not directory.is_dir():
        return None
    names = sorted(
        (p.name for p in directory.iterdir() if FILENAME_RE.match(p.name)),
        reverse=True,
    )
    return names[0] if names else None


def delete_snapshot(name: str) -> bool:
    path = snapshot_path(name)
    if path is None:
        return False
    path.unlink()
    return True
```

`newest_snapshot_name` reuses the existing reverse-lexicographic ordering
(filenames encode the timestamp, so lexicographic == chronological).

### `backend/app/routers/imports.py`

```python
@router.delete("/import/snapshots/{name}", status_code=204)
def delete_snapshot_endpoint(
    name: str,
    force: bool = False,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> None:
    if snapshot_path(name) is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if not force and name == newest_snapshot_name():
        raise HTTPException(
            status_code=409,
            detail="This is the most recent snapshot (your latest restore point)",
        )
    delete_snapshot(name)
    log_event(db, actor=current, event_type="snapshot.deleted",
              entity_type="import", entity_id=None, entity_label=name)
    db.commit()
```

Admin-only (member → 403), consistent with the other snapshot routes. Import
`newest_snapshot_name` and `delete_snapshot` alongside the existing snapshot
helpers.

## Frontend

### `client.ts`

```ts
export function deleteSnapshot(name: string, force = false): Promise<void> {
  return request<void>(
    `${API}/import/snapshots/${encodeURIComponent(name)}${force ? "?force=true" : ""}`,
    { method: "DELETE" },
  );
}
```

### `SnapshotsSection.tsx`

- Per-row **Delete** button (red ghost link, beside Download/Restore),
  `aria-label={`delete snapshot ${s.name}`}`, disabled while a delete is in
  flight.
- State `confirmDelete: SnapshotInfo | null`. The list is newest-first, so the
  newest is `snapshots[0]`; `isNewest = confirmDelete?.name === snapshots[0]?.name`.
- `ConfirmDialog` (title "Delete snapshot?", confirm label "Delete"):
  - non-newest message: `` `${name}\nThis snapshot will be permanently deleted and cannot be undone.` ``
  - newest message: `` `${name}\nThis is your most recent snapshot — your latest restore point. It will be permanently deleted and cannot be undone.` ``
  - onConfirm → `deleteSnapshot(name, isNewest)` (force only for the newest),
    then status line `Snapshot deleted` and reload the list. Failure → error line.
- Shares neither the `restoring` nor `creating` busy flags — separate
  `deleting` state.

**Deliberate choice (approved at design gate):** one adaptive dialog that
sends `force` for the newest, rather than a delete-confirm followed by a
second force-confirm on the 409. The server 409 guard stands independently —
a non-force call (e.g. `curl`) is still refused — so the safety is real; the
UI just warns once with the appropriate message.

## Testing

- **Backend** (`tests/test_snapshot_restore.py`):
  - delete a non-newest snapshot → 204, absent from the list, `snapshot.deleted`
    audit row with the name as label.
  - delete the newest without force → 409; with `?force=true` → 204.
  - delete an unknown/invalid name → 404.
  - member client → 403 (extend `test_snapshot_endpoints_require_admin`).
- **Frontend** (`SnapshotsSection.test.tsx`):
  - clicking Delete on a non-newest row opens the dialog and, on confirm,
    calls `deleteSnapshot(name, false)` and reloads.
  - the newest row's dialog message mentions "most recent" and confirm calls
    `deleteSnapshot(name, true)`.

## Out of scope

- Bulk delete / select-multiple.
- Changing retention (still the shared 20-newest auto-prune pool).
- Guarding anything other than the newest (no "only snapshot" special case
  beyond what newest-guarding already provides).
