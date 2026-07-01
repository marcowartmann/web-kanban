# Globally-unique item number

## Goal

Features, stories, and risks each carry a globally-unique number, starting at 1,
so users can reference an item by a short human-facing id (e.g. `#12`).

## Decisions

- **One shared sequence** across all three kinds (not per-kind counters). A number
  is unique across the whole item set; it is never reused.
- **Reuse the existing `items.id` primary key** as the number. No new column.
- **Continue from previous max** across CSV re-imports (no reset to 1).
- **Display** the number as `#<id>` on board cards and in the item detail drawer.

## Why no backend change

All three kinds live in one `items` table sharing a single autoincrement `id`
(`backend/app/models.py`). That id already meets every requirement:

- Globally unique across features/stories/risks (shared table).
- Starts at 1 on a fresh database.
- Survives CSV `replace_all` re-imports by continuing from the previous max —
  Postgres does not reset a sequence on `DELETE`, which is exactly the desired
  "continue from previous max" behaviour.

`id` is already serialized to the frontend on every `ItemRead` / `BoardCard`, so
no schema, migration, or API change is required.

## Frontend changes

1. **Card** — `frontend/src/components/Card.tsx`: render `#{card.id}` as small,
   muted text in the top row next to the type badge (before the WSJF score).
2. **Drawer header** — `frontend/src/components/ItemDrawer.tsx`: render
   `#{item.id}` next to the type badge in the header row.

Format: plain `#<id>`, e.g. `#12`. No kind prefix.

## Known trade-off

Because the number is the raw shared `id`, it is globally unique but **not
gap-free within a single kind**. A board filtered to stories may show
`#2, #5, #9` because features and risks consume numbers from the same sequence.
This is inherent to a single global sequence over one shared id column and is
consistent with "globally unique, starting with 1".

## Tests

- `frontend/src/components/Card.test.tsx`: assert the card renders `#<id>`.
- `frontend/src/components/ItemDrawer.test.tsx`: assert the drawer renders `#<id>`.
