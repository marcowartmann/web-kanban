# Manual snapshots in Admin — Design

**Date:** 2026-07-03
**Status:** Approved (design gate) — pending spec review

## Context

Snapshots are currently only written automatically (before CSV imports and
restores). The user wants to create one manually from Admin → Snapshots.
All machinery exists (`write_snapshot`, listing, download, restore, pruning);
this adds a trigger.

## Backend (`backend/app/routers/imports.py`)

New endpoint alongside the existing snapshot routes:

```python
@router.post("/import/snapshots", response_model=SnapshotInfo, status_code=201)
def create_snapshot_endpoint(
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> SnapshotInfo:
    name = write_snapshot(db, actor=current.email)
    log_event(db, actor=current, event_type="snapshot.created",
              entity_type="import", entity_id=None, entity_label=name)
    db.commit()
    info = next(s for s in list_snapshots() if s["name"] == name)
    return SnapshotInfo(**info)
```

- Admin-only (member → 403), consistent with the other snapshot routes.
- Audit `snapshot.created` matches the existing `import.restored` idiom
  (entity_type "import", label = filename).
- Returns the new snapshot's `SnapshotInfo` (name, created_at, actor, counts).
- Retention unchanged: the pool keeps the 20 newest snapshots, manual and
  automatic alike (user-approved).

## Frontend

- `client.ts`: `createSnapshot(): Promise<SnapshotInfo>` — POST to
  `${API}/import/snapshots`.
- `SnapshotsSection.tsx`:
  - "Create snapshot" button (`btnPrimary` from ui.ts, `ml-auto` beside the
    count pill in the AdminCard header is not possible — AdminCard owns its
    header, so the button goes in a row directly under the header, above the
    status line: `<div className="mb-3"><button ...>Create snapshot</button></div>`).
  - Click → `createSnapshot()`; success sets the status line
    `Snapshot created — N items, N comments, N links` and reloads the list;
    failure sets the error line. Button disabled while creating (`busy` state,
    shared with `restoring` is NOT reused — separate `creating` state).
  - No confirm dialog (non-destructive).
  - Empty-state copy becomes: "No snapshots yet — create one here, or import
    a CSV (one is created automatically before every import)."

## Testing

- **Backend** (`tests/test_snapshot_restore.py`): POST creates a listed
  snapshot with correct counts and returns them; member client gets 403;
  an `AuditEvent` row `snapshot.created` exists with the name as label.
- **Frontend** (`SnapshotsSection.test.tsx`): clicking "Create snapshot"
  calls the client and the reloaded list renders the new snapshot; the
  success note shows the counts.

## Out of scope

- Prune-exemption or naming for manual snapshots (shared 20-newest pool).
- Snapshot deletion UI, notes/labels on snapshots.
