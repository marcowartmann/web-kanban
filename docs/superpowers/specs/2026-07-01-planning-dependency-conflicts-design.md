# Planning Dependency Badges & Timeline Conflicts — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending spec review

## Goal

Surface dependency links **on the Planning board** and flag **timeline
conflicts** created by the sequential nature of iterations. Iterations within a
Planning Interval (PI) run in order (1 → 2 → 3 → 4 → 5 → IP). A `blocks` link
means the blocker must be done before the blocked item, so if the blocker is
scheduled *after* (or not before) the item it blocks, that is a planning problem
the board should make visible.

Frontend-only: the client already has all `items` (every PI) and the flat
`links` list; stories already carry `iteration` and `planning_interval`.

## Conflict model

Only `blocks` edges produce conflicts (they are directional and time-ordered);
`relates_to` is symmetric and only contributes a count badge.

For a `blocks` edge **A → B** ("A blocks B", A must finish before B), within the
currently selected PI `pi`, define each endpoint's *position*:

- A **story** whose `planning_interval === pi` and `iteration ∈ 1..6` →
  planned at that iteration.
- Anything else (this PI's backlog = `iteration null`, a story in another PI, or
  a non-story feature/risk) → **unscheduled** relative to this PI.

Classification (only when the **blocked** item B is planned in this PI — only
then is there a timeline to violate):

| Blocker A | Blocked B | Result |
|-----------|-----------|--------|
| planned, `A.iter > B.iter` | planned | **error** (blocker scheduled after the blocked item) |
| planned, `A.iter === B.iter` | planned | **warning** (same iteration — intra-iteration order not guaranteed) |
| planned, `A.iter < B.iter` | planned | OK (no conflict) |
| unscheduled in this PI | planned | **warning** (unscheduled blocker) |

Attachment:

- **error** and **same-iteration warning**: both endpoints are planned and
  visible, so the conflict attaches to **both** A and B (with endpoint-specific
  messages).
- **unscheduled-blocker warning**: attaches to the planned item **B** only. (The
  backlog/other-PI blocker is not itself "wrong"; v1 does not flag it.)

A card's overall severity is the worst of its conflicts (`error` > `warning`).

## Module & data flow

New pure helper **`frontend/src/lib/planningLinks.ts`**:

```ts
export type ConflictSeverity = "error" | "warning";

export interface CardConflict {
  severity: ConflictSeverity;
  message: string;
}

export interface CardLinkInfo {
  blocks_count: number;       // outgoing blocks edges
  blocked_by_count: number;   // incoming blocks edges
  related_count: number;      // relates_to edges (either endpoint)
  conflicts: CardConflict[];
}

export function computePlanningLinks(
  items: Item[],
  links: LinkRow[],
  pi: string,
): Map<number, CardLinkInfo>;
```

- Counts are per item across **all** links (matches the board badges), keyed by
  item id.
- Conflicts are computed against `pi` as above.
- Endpoint titles/kinds/iterations are resolved from an `id → Item` map built
  from the full `items` list, so messages can name the other item
  (`"<title>" (#<id>)`).

**`iterationLabel(n)`** (from `lib/iterations.ts`) formats iteration numbers in
messages (`"Iteration 5"`, `"IP"`).

Message text:

- error, on B: `Blocked by "<A.title>" (#<A.id>) scheduled in <IterLabel(A)> (after this)`
- error, on A: `Blocks "<B.title>" (#<B.id>) in <IterLabel(B)> (before this)`
- same-iteration, on B: `Same iteration as blocker "<A.title>" (#<A.id>)`
- same-iteration, on A: `Same iteration as blocked "<B.title>" (#<B.id>)`
- unscheduled blocker, on B: `Blocked by "<A.title>" (#<A.id>), not scheduled in this PI`

**Wiring:**

- `App.tsx` passes `links` (already from `useBoard`) to `PlanningView`.
- `PlanningView` memoizes `computePlanningLinks(items, links, pi)` over the
  **full unfiltered** `items` (so detection is correct even when the team /
  assignee filter hides a blocker), keyed off `[items, links, pi]`. It threads
  each card's `CardLinkInfo` through `PlanningColumn` → `StoryPlanCard` via a
  `Map<number, CardLinkInfo>` (or per-card lookup).

## Visualization (`StoryPlanCard`)

- **Badge row** (below assignee / SP), rendered only when a count > 0, matching
  the board `Card` style: `⛔ blocked by {n}` (red), `blocks {n}`,
  `related {n}` (gray).
- **Conflict indicator** when `conflicts.length > 0`:
  - Card gets a colored ring — **red** (`ring-2 ring-red-400`) if any conflict is
    `error`, else **amber** (`ring-2 ring-amber-400`) for warnings only.
  - A ⚠ marker in the card whose native `title` attribute is the newline-joined
    conflict messages (hover tooltip). No custom tooltip component in v1.

`StoryPlanCard` gains one optional prop `info?: CardLinkInfo`; existing renders
without it are unaffected.

## Testing

**`lib/planningLinks.test.ts`:**

- blocker in a later iteration than blocked → `error` on **both** endpoints.
- blocker in the same iteration → `warning` on both.
- blocker in an earlier iteration → no conflict.
- blocked planned, blocker unscheduled (this PI's backlog / other PI / a
  feature) → `warning` on the blocked item only.
- counts: `blocks_count` / `blocked_by_count` from `blocks` edges,
  `related_count` from `relates_to` (both endpoints), no conflict from
  `relates_to`.
- an edge whose blocked item is not in `pi` produces no conflict.

**`StoryPlanCard` tests (`StoryPlanCard.test.tsx`):**

- renders count badges when present; hides them at 0.
- `error` conflict → red ring + ⚠ present; tooltip (`title`) contains the message.
- `warning`-only → amber ring.
- no `info` / empty conflicts → no ring, no ⚠.

Backend: unchanged. No API, schema, or migration changes.

## Scope guards (v1 — YAGNI)

- Conflicts only from `blocks` edges; `relates_to` is a count badge only.
- Only stories carry iterations; feature/risk endpoints count as "unscheduled".
- The unscheduled-blocker warning attaches to the planned (blocked) item, not to
  the backlog/other-PI blocker.
- No cross-PI iteration ordering math — another PI is simply "unscheduled"
  relative to the viewed PI.
- Native `title` tooltip only; no custom hover component, no dependency graph
  lines between cards.
