# Feature Ranking Page — Design

**Date:** 2026-07-03
**Status:** Approved (design)

## Goal

A new **Ranking** page that shows features in two side-by-side orderings:

1. **WSJF ranking** — read-only, features sorted by their computed `wsjf_score`.
2. **Manual ranking** — a user-maintained ordering, reordered by drag-and-drop,
   backed by a new `manual_rank` field.

Features are all items of `kind=feature`. The page shows all features, with
filters (planning interval, team, container). The manual ranking is a single
**global** ordering across all features.

## Data model & ordering

- New nullable column **`Item.manual_rank: int | None`**. `null` = not yet
  manually ranked. One Alembic migration adds the column; no backfill.
- `manual_rank` is added to the `ItemRead` schema so the page reuses the
  existing items feed (no new GET endpoint).
- **Resolved manual order** (used for display and as the basis for reordering):
  sort by `manual_rank ASC (nulls last)`, then `wsjf_score DESC (nulls last)`,
  then `id ASC`. Before any drag, the manual list mirrors the WSJF order; once
  features are dragged, persisted `manual_rank` values take precedence.
- **WSJF order** (left list): `wsjf_score DESC (nulls last)`, then `id ASC`.
  Read-only; never persisted from this page.

## Permission model

Strict team gating, **no admin override**:

- A feature is reorderable **iff the caller's team name is set and equals the
  feature's `leading_team`** (`user.team.name == feature.leading_team`).
- Features whose `leading_team` is empty or matches no user's team are **locked
  for everyone** — they cannot be moved and keep their place.
- The backend enforces this authoritatively: a reorder request for a feature the
  caller does not own returns `403`.
- Only the **moved** feature is permission-checked. The anchor (`after_id`) is
  not — you may drop your feature anywhere in the shared list.

**Accepted consequence (global ordering):** because the manual list is one global
ordering, moving a feature you own renumbers the `manual_rank` integers of every
other feature (including other teams'). Ownership (`leading_team`) never changes;
only numeric position within the shared list does.

## API

### Reuse: `GET /api/v1/items`
Add `manual_rank` to `ItemRead`. The page derives both lists client-side from
the already-loaded items (filter `kind=feature`, sort as above).

### New: `POST /api/v1/features/ranking/reorder`
Body: `{ "feature_id": int, "after_id": int | null }` (`after_id=null` → move to
the top).

Behaviour:
1. Resolve the caller (`require_user`) and their team name via the user→team
   relationship.
2. Load `feature_id`; `404` if missing; `422` if `kind != feature`.
3. Authorize: `403` unless `caller.team is not None and
   caller.team.name == feature.leading_team`.
4. If `after_id` is provided: load it; `404` if missing or not a feature.
5. Compute the resolved global manual order of all features, remove the moved
   feature, re-insert it immediately after `after_id` (or at the front when
   `null`), then assign dense `manual_rank = 1..N` in that order. One
   transaction.
6. Emit a light audit event `feature.reranked` (entity = the moved feature).
7. Return `204`; the client reloads the items feed (which now carries the new
   `manual_rank` values), matching the existing board/reload flow.

Anchoring to `after_id` (a concrete feature) keeps reordering correct even when
the visible list is filtered.

## Frontend

### Navigation
Add a **Ranking** entry to the segmented nav in `App.tsx` (`View` gains
`"ranking"`), visible to all logged-in users. Render `RankingView`.

### `RankingView.tsx`
- Consumes the loaded `items` (features only) plus `planningIntervals`,
  `teams`, `containers`, and the current `user` (for `team_name`).
- A filter bar reusing `FilterSelect`: planning interval, team, container. Both
  lists show the same filtered set.
- **Left list — WSJF (read-only):** rows show rank #, title, `wsjf_score`,
  leading team. Sorted by WSJF order.
- **Right list — Manual (drag):** rows in resolved manual order, wrapped in
  `@dnd-kit/sortable`. A row is draggable **iff
  `user.team_name && feature.leading_team === user.team_name`**; non-owned rows
  render locked (🔒), no drag handle.
- On drag end, call the reorder API with `{ feature_id, after_id }` derived from
  the drop target, then reload via the existing `onChanged`/`reload` flow.

### Client (`api/client.ts`)
- Add `reorderFeatureRanking(featureId: number, afterId: number | null)`.
- `Item` type gains `manual_rank?: number | null`.

## Testing

### Backend
- **Migration:** upgrade + downgrade against the compose Postgres (project rule);
  assert the `manual_rank` column appears/disappears.
- **Reorder endpoint** (`tests/test_api_feature_ranking.py`):
  - Happy path: an own-team user moves a feature; `manual_rank` renumbers 1..N in
    the expected order.
  - `after_id=null` moves the feature to the top (`manual_rank=1`).
  - `403` when the caller's team does not match the feature's `leading_team`.
  - `403` for a user with no team.
  - `404` for an unknown `feature_id`/`after_id`; `422` when the id is not a feature.
  - Default order materializes: with all `manual_rank` null, the first reorder
    produces WSJF-descending ranks with the moved feature repositioned.
- **Serialization:** `manual_rank` present in `ItemRead`.

### Frontend (`RankingView.test.tsx`)
- Both lists render in the correct order for a fixture set.
- Only rows whose `leading_team` matches the user's team are draggable; others
  show the locked affordance.
- A drag calls `reorderFeatureRanking` with the right `feature_id`/`after_id`.

## Out of scope

- Per-team separate manual orderings (explicitly rejected in favour of one global
  ordering).
- Typing a priority number directly (the field is drag-maintained only).
- Reordering non-feature items.
- Reflecting manual_rank anywhere outside this page.

## Files touched (anticipated)

- `backend/app/models.py` — `Item.manual_rank`.
- `backend/alembic/versions/0018_item_manual_rank.py` — migration.
- `backend/app/schemas.py` — `manual_rank` in `ItemRead`; reorder request schema.
- `backend/app/routers/features_ranking.py` — new reorder router (or add to `items.py`).
- `backend/app/main.py` — include the new router (if separate).
- `backend/tests/test_api_feature_ranking.py` — new tests.
- `frontend/src/App.tsx` — nav entry + `RankingView` wiring.
- `frontend/src/components/RankingView.tsx` — new.
- `frontend/src/components/RankingView.test.tsx` — new.
- `frontend/src/api/client.ts` — `reorderFeatureRanking`; `Item.manual_rank`.
- `frontend/src/types.ts` — `Item.manual_rank`.
