# Risk Scope (ART / Team) — Design

**Date:** 2026-07-04
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Label each risk card in the UI as an **ART risk** or a **team risk**, driven by
a new persisted `risk_scope` field backfilled from the existing `kategorie`
value.

## Decisions (from brainstorming)

1. Store the classification in a new DB column `Item.risk_scope`, not derived
   on the fly.
2. Backfill it from `kategorie`: `"ART Risk"` → art, `"Team Risk"` → team
   (case-insensitive substring match), risks only.
3. UI shows a short pill: **ART** or **Team**.

## Data model

New column on `items`:

- `risk_scope: Mapped[str | None]` — `String(16)`, nullable, no index.
- Domain values: `"art"`, `"team"`, or `NULL`.
- Only `kind == "risk"` items carry a non-null value; features/stories stay
  `NULL`.

## Classification helper (single source of truth)

Pure function in the backend, `classify_risk_scope(kind, kategorie) -> str | None`:

```python
def classify_risk_scope(kind, kategorie):
    if kind != ItemKind.RISK or not kategorie:
        return None
    low = kategorie.lower()
    if "art risk" in low:
        return "art"
    if "team risk" in low:
        return "team"
    return None
```

Placed in `backend/app/csv_import.py` (where `kategorie` is already parsed) and
imported by the CSV import path. The migration backfill uses equivalent SQL so
the rule is expressed once in Python and mirrored once in SQL.

Precedence note: `"art risk"` is checked before `"team risk"`. Observed data
has exactly one of the two, so precedence is not exercised, but it is defined
to keep the function total.

## Migration

New Alembic revision after the current head:

- **Upgrade:**
  - `op.add_column("items", sa.Column("risk_scope", sa.String(16), nullable=True))`
  - Backfill:
    - `UPDATE items SET risk_scope='art'  WHERE kind='risk' AND lower(kategorie) LIKE '%art risk%'`
    - `UPDATE items SET risk_scope='team' WHERE kind='risk' AND lower(kategorie) LIKE '%team risk%'`
- **Downgrade:** `op.drop_column("items", "risk_scope")`.
- Dry-run upgrade **and** downgrade against the compose Postgres before
  accepting (per project migration rule).

## Import

The CSV import performs a full replace of items. When building each risk's data
dict, set `risk_scope = classify_risk_scope(kind, kategorie)`. This keeps the
value correct after every re-import (otherwise the backfill would be lost on the
next import).

Snapshot restore is unaffected: it re-inserts stored column values verbatim,
and `risk_scope` is just another column captured in the snapshot.

## API / schema

Add `risk_scope: str | None = None` to:

- `ItemBase` (so it serializes on `ItemRead`).

No new endpoint. No write path from the UI (the value is import/backfill-driven,
not user-editable) — so it is intentionally omitted from `ItemUpdate`.

## Frontend

- `types.ts`: add `risk_scope?: "art" | "team" | null` to the item/`BoardCard`
  type.
- `Card.tsx`: after the type badge and `#id`, render a pill when
  `card.kind === "risk"` and `card.risk_scope` is set:
  - `"art"` → text **ART**, amber tint (`bg-amber-100 text-amber-800`).
  - `"team"` → text **Team**, slate tint (`bg-slate-100 text-slate-700`).
  - `NULL` → render nothing.
- Risks render only on the Board, so `Card.tsx` is the only card component that
  needs the change. The item drawer is out of scope for this change.

Dark theme: the tinted badges follow the existing badge convention (e.g. the
violet `admin` / `LDAP` pills), which already read correctly in dark mode via
the gray-ramp; no extra work needed.

## Testing

- Backend unit: `classify_risk_scope` — risk+"ART Risk"→"art",
  risk+"Team Risk"→"team", risk+other→None, non-risk→None, empty kategorie→None,
  case-insensitivity.
- Backend migration: dry-run upgrade+downgrade on compose Postgres; after
  upgrade, a seeded risk with `kategorie='ART Risk'` gets `risk_scope='art'`.
- Backend import: importing the fixture CSV yields risks with the expected
  `risk_scope` values (fixture has both ART Risk and Team Risk rows).
- Frontend: `Card` renders the **ART**/**Team** pill for a risk card with the
  matching scope, and renders no such pill for a feature card.

## Out of scope

- Editing `risk_scope` from the UI.
- Labeling risks anywhere other than the board card (no risks appear in
  planning/timeline/ranking).
- Filtering/grouping by risk scope.
