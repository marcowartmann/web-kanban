# Risk Scope (ART / Team) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a `risk_scope` classification ("art"/"team") on risk items, backfilled from `kategorie`, and label risk cards **ART**/**Team** in the UI.

**Architecture:** One pure classifier (`classify_risk_scope`) is the single source of truth; a new nullable `items.risk_scope` column is populated by an Alembic backfill and by the CSV import (which mirrors the classifier). The value serializes on `ItemRead` and drives a small pill in `Card.tsx`.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic (Postgres in Docker / SQLite in-memory for unit tests); React + TypeScript + Vite + vitest.

## Global Constraints

- Domain values are exactly `"art"`, `"team"`, or `NULL`; only `kind == risk` items get a non-null value.
- Classifier rule: case-insensitive substring — `"art risk"` → `"art"`, `"team risk"` → `"team"`, checked in that order.
- `risk_scope` is import/backfill-driven only; it is NOT user-editable (omit from `ItemUpdate`).
- Migration rule: dry-run upgrade **and** downgrade against the compose Postgres before accepting (SQLite unit tests never run Alembic DDL).
- New migration: `revision = "0021"`, `down_revision = "0020"`.
- Run backend commands from `backend/` (or `docker compose exec backend`); run frontend commands from `frontend/`. Always `cd /Users/marco/Coding/web-kanban` for git.

---

### Task 1: `classify_risk_scope` helper

**Files:**
- Modify: `backend/app/csv_import.py` (add function near the top-level helpers)
- Test: `backend/tests/test_risk_scope.py` (create)

**Interfaces:**
- Produces: `classify_risk_scope(kind: ItemKind, kategorie: str | None) -> str | None`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_risk_scope.py
from app.csv_import import classify_risk_scope
from app.models import ItemKind


def test_art_risk_from_kategorie():
    assert classify_risk_scope(ItemKind.RISK, "ART Risk") == "art"


def test_team_risk_from_kategorie():
    assert classify_risk_scope(ItemKind.RISK, "Team Risk") == "team"


def test_case_insensitive_and_substring():
    assert classify_risk_scope(ItemKind.RISK, "some ART RISK note") == "art"
    assert classify_risk_scope(ItemKind.RISK, "team risk") == "team"


def test_risk_without_marker_is_none():
    assert classify_risk_scope(ItemKind.RISK, "Infrastruktur") is None
    assert classify_risk_scope(ItemKind.RISK, None) is None
    assert classify_risk_scope(ItemKind.RISK, "") is None


def test_non_risk_is_none():
    assert classify_risk_scope(ItemKind.FEATURE, "ART Risk") is None
    assert classify_risk_scope(ItemKind.STORY, "Team Risk") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_risk_scope.py -q`
Expected: FAIL — `ImportError: cannot import name 'classify_risk_scope'`.

- [ ] **Step 3: Implement the helper**

In `backend/app/csv_import.py`, add after the imports (it uses `ItemKind`, already imported there):

```python
def classify_risk_scope(kind: "ItemKind", kategorie: str | None) -> str | None:
    """ART/Team classification for a risk, derived from its kategorie text.

    Returns None for non-risks and for risks whose kategorie names neither.
    """
    from app.models import ItemKind

    if kind != ItemKind.RISK or not kategorie:
        return None
    low = kategorie.lower()
    if "art risk" in low:
        return "art"
    if "team risk" in low:
        return "team"
    return None
```

(If `ItemKind` is already imported at module top in `csv_import.py`, drop the
inner import and the string annotation and use `ItemKind` directly.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_risk_scope.py -q`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/csv_import.py backend/tests/test_risk_scope.py
git commit -m "feat(risk-scope): classify_risk_scope helper"
```

---

### Task 2: Model column + Alembic migration with backfill

**Files:**
- Modify: `backend/app/models.py` (add `risk_scope` to `Item`)
- Create: `backend/alembic/versions/0021_item_risk_scope.py`

**Interfaces:**
- Produces: `Item.risk_scope` column (`String(16)`, nullable); DB column `items.risk_scope`.

- [ ] **Step 1: Add the model column**

In `backend/app/models.py`, in the `Item` class next to `kategorie`/`art`
(around line 42), add:

```python
    risk_scope: Mapped[str | None] = mapped_column(String(16))
```

- [ ] **Step 2: Create the migration**

`backend/alembic/versions/0021_item_risk_scope.py`:

```python
"""item.risk_scope (art/team), backfilled from kategorie

Revision ID: 0021
Revises: 0020
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("risk_scope", sa.String(16), nullable=True))
    op.execute(
        "UPDATE items SET risk_scope = 'art' "
        "WHERE kind = 'RISK' AND lower(kategorie) LIKE '%art risk%'"
    )
    op.execute(
        "UPDATE items SET risk_scope = 'team' "
        "WHERE kind = 'RISK' AND lower(kategorie) LIKE '%team risk%'"
    )


def downgrade() -> None:
    op.drop_column("items", "risk_scope")
```

Note: `kind` is stored via `Enum(ItemKind, native_enum=False)`, so the column
holds the enum **name** `'RISK'` (uppercase). Confirm in Step 4.

- [ ] **Step 3: Verify the stored kind value before trusting the backfill WHERE**

Run: `cd /Users/marco/Coding/web-kanban && docker compose exec -T db psql -U kanban -d kanban -c "SELECT DISTINCT kind FROM items;"`
Expected: values like `FEATURE`, `STORY`, `RISK` (uppercase enum names). If they
are lowercase, change the migration's `kind = 'RISK'` accordingly.

- [ ] **Step 4: Dry-run the migration up and down on compose Postgres**

```bash
cd /Users/marco/Coding/web-kanban
docker compose cp backend/alembic/versions/0021_item_risk_scope.py backend:/app/alembic/versions/0021_item_risk_scope.py
docker compose exec backend alembic upgrade head
docker compose exec -T db psql -U kanban -d kanban -c "\d items" | grep risk_scope
docker compose exec backend alembic downgrade -1
docker compose exec -T db psql -U kanban -d kanban -c "\d items" | grep risk_scope || echo "column dropped OK"
docker compose exec backend alembic upgrade head
```
Expected: after upgrade the `risk_scope` column exists; after downgrade it is
gone ("column dropped OK"); final upgrade re-applies it. No errors.

- [ ] **Step 5: Verify the backend test suite still imports/creates the model**

Run: `cd backend && python -m pytest -q -k "item or import" 2>&1 | tail -5`
Expected: no collection errors; existing tests pass (SQLite `create_all` now
includes the new column).

- [ ] **Step 6: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/models.py backend/alembic/versions/0021_item_risk_scope.py
git commit -m "feat(risk-scope): items.risk_scope column + backfill migration"
```

---

### Task 3: Schema field + import wiring

**Files:**
- Modify: `backend/app/schemas.py` (`ItemBase`)
- Modify: `backend/app/csv_import.py` (`parse_items`)
- Test: `backend/tests/test_import_risk_scope.py` (create)

**Interfaces:**
- Consumes: `classify_risk_scope` (Task 1), `Item.risk_scope` (Task 2).
- Produces: `ItemRead.risk_scope` in API payloads; imported risks carry `risk_scope`.

- [ ] **Step 1: Write the failing import test**

```python
# backend/tests/test_import_risk_scope.py
from app.csv_import import parse_items


def _rows(*dicts):
    return list(dicts)


def test_import_sets_risk_scope_from_kategorie():
    rows = _rows(
        {"Title": "Feature A", "Type": "Feature", "Kategorie": "Infrastruktur"},
        {"Title": "R1", "Type": "Risk", "Kategorie": "ART Risk"},
        {"Title": "R2", "Type": "Risk", "Kategorie": "Team Risk"},
        {"Title": "R3", "Type": "Risk", "Kategorie": "Infrastruktur"},
    )
    parsed = parse_items(rows)
    scopes = {r.data["title"]: r.data.get("risk_scope") for r in parsed.risks}
    assert scopes == {"R1": "art", "R2": "team", "R3": None}
    # non-risk items carry no scope
    assert parsed.features[0].data.get("risk_scope") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_import_risk_scope.py -q`
Expected: FAIL — `risk_scope` key missing (KeyError/None mismatch).

- [ ] **Step 3: Wire risk_scope into `parse_items`**

In `backend/app/csv_import.py`, inside `parse_items`, right after
`data = _row_to_data(row)` (and after `kind` is computed), add:

```python
        data["risk_scope"] = classify_risk_scope(kind, data.get("kategorie"))
```

This sets `risk_scope` for every item: features/stories get `None`, risks get
`"art"`/`"team"`/`None`. `_insert_item` spreads `**data` into `Item(...)`, so the
column is populated on insert.

- [ ] **Step 4: Add the schema field**

In `backend/app/schemas.py`, in `ItemBase` (next to `kategorie`/`art`, ~line 13):

```python
    risk_scope: str | None = None
```

- [ ] **Step 5: Run the import test + full backend suite**

Run: `cd backend && python -m pytest tests/test_import_risk_scope.py -q`
Expected: PASS.

Run: `cd backend && python -m pytest -q 2>&1 | tail -5`
Expected: all tests pass.

- [ ] **Step 6: End-to-end import check on the Docker stack**

```bash
cd /Users/marco/Coding/web-kanban
docker compose exec -T db psql -U kanban -d kanban -c \
  "SELECT risk_scope, count(*) FROM items WHERE kind='RISK' GROUP BY risk_scope;"
```
(After re-importing the CSV via Admin → Import CSV, expect rows grouped as
`art`, `team`, and possibly NULL. If the DB has no risks yet, this is exercised
after the next import — the parse-level test already proves the wiring.)

- [ ] **Step 7: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add backend/app/schemas.py backend/app/csv_import.py backend/tests/test_import_risk_scope.py
git commit -m "feat(risk-scope): derive on import + expose on ItemRead"
```

---

### Task 4: Frontend ART/Team pill on risk cards

**Files:**
- Modify: `frontend/src/types.ts` (item/`BoardCard` type)
- Modify: `frontend/src/components/Card.tsx`
- Test: `frontend/src/components/Card.test.tsx` (create if absent; else extend)

**Interfaces:**
- Consumes: `risk_scope` on the card object (from `ItemRead`).

- [ ] **Step 1: Add the type field**

In `frontend/src/types.ts`, add to the interface backing `BoardCard`/items
(next to `kategorie`/`art` if present, else alongside `kind`):

```ts
  risk_scope?: "art" | "team" | null;
```

- [ ] **Step 2: Write the failing Card test**

```tsx
// frontend/src/components/Card.test.tsx
import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { BoardCard } from "../types";
import Card from "./Card";

const base = {
  id: 1, kind: "risk", type: "Risk", title: "R1",
  children_count: 0, children_points: 0,
} as unknown as BoardCard;

const renderCard = (card: BoardCard) =>
  render(
    <DndContext>
      <Card card={card} onOpen={() => {}} />
    </DndContext>,
  );

it("labels an ART risk", () => {
  renderCard({ ...base, risk_scope: "art" } as BoardCard);
  expect(screen.getByText("ART")).toBeInTheDocument();
});

it("labels a team risk", () => {
  renderCard({ ...base, risk_scope: "team" } as BoardCard);
  expect(screen.getByText("Team")).toBeInTheDocument();
});

it("shows no scope pill for a feature", () => {
  renderCard({
    ...base, id: 2, kind: "feature", type: "Feature", risk_scope: null,
  } as BoardCard);
  expect(screen.queryByText("ART")).not.toBeInTheDocument();
  expect(screen.queryByText("Team")).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/Card.test.tsx`
Expected: FAIL — "ART"/"Team" not found.

- [ ] **Step 4: Render the pill in `Card.tsx`**

In `frontend/src/components/Card.tsx`, inside the header row `<span className="flex items-center gap-1.5">` (right after the `#{card.id}` span), add:

```tsx
            {card.kind === "risk" && card.risk_scope && (
              <span
                className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${
                  card.risk_scope === "art"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {card.risk_scope === "art" ? "ART" : "Team"}
              </span>
            )}
```

- [ ] **Step 5: Run the Card test + full frontend suite**

Run: `cd frontend && npx vitest run src/components/Card.test.tsx`
Expected: PASS (3 tests).

Run: `cd frontend && npm test 2>&1 | grep -E "Test Files|Tests " | tail -2`
Expected: all pass.

- [ ] **Step 6: Build + Docker visual check**

Run: `cd frontend && npm run build` → clean.

```bash
cd /Users/marco/Coding/web-kanban
docker compose build frontend && docker compose up -d frontend
```
Open the Risks board; a risk with an ART kategorie shows an amber **ART** pill,
a team risk shows a slate **Team** pill, next to the red "Risk" badge. Toggle
dark mode and confirm both pills stay legible.

- [ ] **Step 7: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/types.ts frontend/src/components/Card.tsx frontend/src/components/Card.test.tsx
git commit -m "feat(risk-scope): ART/Team pill on risk cards"
```

---

## After all tasks

Use **superpowers:finishing-a-development-branch**: verify backend + frontend
suites green, then present merge/PR/keep/discard options.

## Self-Review notes

- **Spec coverage:** data model (Task 2), classifier (Task 1), migration+backfill
  (Task 2), import derivation (Task 3), schema exposure (Task 3), UI pill (Task 4),
  testing (each task). All spec sections mapped.
- **Type consistency:** `classify_risk_scope(kind, kategorie)`, `risk_scope`
  values `"art"`/`"team"`/`None`, and the `"art"/"team"` string checks are used
  identically in the model, migration, import, schema, and frontend.
- **No placeholders:** every step has concrete code/commands.
- **Watch item (flagged for executor):** confirm the stored `kind` casing
  (Task 2 Step 3) before trusting the backfill/import `WHERE kind='RISK'`; and if
  `ItemKind` is already imported at the top of `csv_import.py`, simplify the
  helper's inner import (Task 1 Step 3).
