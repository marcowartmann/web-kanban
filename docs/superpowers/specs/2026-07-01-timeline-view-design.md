# Timeline View — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending spec review

## Goal

A new **Timeline** view (nav tab beside Board / Planning / Admin) that gives a
dependency-oriented overview of features and stories across the iterations of a
Planning Interval. Two modes: **By feature** (feature swimlanes with their
stories placed on the iteration timeline) and **Dependencies** (focus on a
selected item's full dependency chain). Items render as cards like the other
boards; dependencies are conveyed with the existing badges + hover-highlight
(no drawn connector lines). Frontend-only — reuses the existing `items` + `links`
already loaded by `useBoard`.

## Axis & reuse

- Horizontal axis = the six iteration slots of one selected PI: **Backlog**
  (unscheduled), **Iteration 1–5**, **IP** — same slots as Planning
  (`ITERATION_SLOTS`, `iterationLabel`).
- Per-card dependency info (counts, conflicts, `conflictPartners`,
  `linkPartners`) comes from the existing `computePlanningLinks(items, links,
  pi)`. Story cards reuse **`StoryPlanCard`** (badges, ⚠/🔗, hover
  highlight/dim, drag). The hover-highlight mechanism (a shared `highlight`
  set + `onHighlight`) is reused verbatim.

## Controls (top bar)

- **PI selector** — pills, identical to Planning (`planningIntervals`).
- **Mode toggle** — `By feature` ⇄ `Dependencies`.
- **`Show all` / `Only planned` toggle** — feature mode only. *Show all* renders
  the leading **Backlog** column (per-lane unplanned stories) and keeps features
  that have no planned stories; *Only planned* hides both. Default: *Show all*.

## By-feature mode

Layout: rows = features (swimlanes), columns = iterations.

```
                 Backlog   Iter1   Iter2   Iter3  Iter4  Iter5   IP
Feature A         [S0]     [S1]    [S2]
Feature B                  [S3]                   [S4]
(No feature)               [S7]
```

- Each row has a sticky **feature card** on the left (a `FeatureCard` styled like
  the board cards: type chip, title, `#id`, dependency badges from
  `computePlanningLinks`), then one **cell** per iteration column containing that
  feature's stories for that slot, rendered as `StoryPlanCard`s.
- Stories with no parent feature go in a trailing **"No feature"** lane
  (`feature: null`).
- **Drag** (dnd-kit, like Planning): each cell is a droppable; dropping a story
  sets its `iteration` (Backlog → `null`) via `updateItem`, then reloads. Cell
  droppable ids are `` `${laneKey}::${slot}` `` (unique per lane); the drag
  handler parses the `slot` after `::`. The card snaps back into its own
  feature's row (feature is unchanged). Feature cards are **not** draggable.

## Dependencies mode

- Renders the **flat** iteration layout (Backlog + Iter1–IP, single set of
  columns — not grouped by feature).
- **Selection:** in this mode a card click **toggles selection** (a blue ring)
  instead of opening the drawer. With an empty selection, the PI's **stories** are
  shown flat (`layoutFlat(pi-stories)`) so you can start picking. With a non-empty
  selection, the view shows the **transitive dependency component** of the
  selected ids (`layoutFlat` over the items whose id is in
  `dependencyComponent(...)`) — which may pull in features and other-PI items. A
  **Clear** button resets the selection.
- Items place by iteration when they are a story in this PI with an iteration;
  everything else in the component (features, unplanned stories, other-PI items)
  lands in the **Backlog** column. Badges + hover-highlight still apply.

## Data helpers — `frontend/src/lib/timeline.ts`

```ts
import type { Item, LinkRow } from "../types";
import type { IterationSlot } from "./iterations";

export interface FeatureLane {
  feature: Item | null;                 // null = the "No feature" orphan lane
  backlog: Item[];                      // stories with no iteration
  slots: Record<IterationSlot, Item[]>; // stories by iteration 1..6
}

// Group a PI's stories into feature swimlanes.
// showAll=false: drop backlog stories and lanes with no slotted story.
// showAll=true:  keep backlog + include features in this PI that have no stories.
export function groupByFeature(
  items: Item[],
  pi: string,
  opts: { showAll: boolean },
): FeatureLane[];

// Transitive closure over blocks + relates_to (both directions) from the seeds.
export function dependencyComponent(
  items: Item[],
  links: LinkRow[],
  selectedIds: Iterable<number>,
): Set<number>;

// Flat placement of the given items onto this PI's slots (non-PI-stories and
// items without an iteration fall into `backlog`). Used by Dependencies mode.
export function layoutFlat(
  items: Item[],
  pi: string,
): { backlog: Item[]; slots: Record<IterationSlot, Item[]> };
```

`groupByFeature` details: a lane exists for each feature that has ≥1 story in
`pi`; in `showAll`, also for each `feature` whose `planning_interval === pi` even
with no PI stories. Lanes sort by `feature.position` (then title); the orphan
lane is last. When `!showAll`, a feature lane is included only if it has ≥1 story
in `slots` (backlog-only features are hidden). `dependencyComponent` builds an
undirected adjacency from every `blocks`/`relates_to` edge and BFS-collects all
ids reachable from the seeds (seeds included).

## Components

- **`TimelineView.tsx`** — owns state (`pi`, `mode`, `showAll`, `highlight:
  Set<number> | null`, `selected: Set<number>`), computes `cardInfo =
  computePlanningLinks(items, links, pi)`, builds either `groupByFeature(...)` or
  `layoutFlat(dependency-filtered items)`, and renders the grid inside one
  `DndContext`. Card click → `onOpenCard` (feature mode) or toggle-select
  (dependencies mode).
- **`TimelineLane.tsx`** — one row: optional `FeatureCard` header + the iteration
  cells; receives `highlight`, `onHighlight`, `cardInfo`, drag wiring.
- **`TimelineCell.tsx`** — a droppable slot rendering the `StoryPlanCard`s it
  holds.
- **`FeatureCard.tsx`** — presentational feature lane header card (not draggable);
  shows badges/conflict marker from its `CardLinkInfo` and is click-to-open (or
  selectable in dependencies mode).
- **`StoryPlanCard`** gains an optional `selected?: boolean` (blue ring) for
  dependencies mode; existing behavior unchanged.
- **App** (`App.tsx`): add `"timeline"` to the `View` union + a nav button, and
  render `<TimelineView items={items} links={links}
  planningIntervals={planningIntervals} onOpenCard={openItem}
  onChanged={handleChanged} />`.

Drag handler `handleTimelineDragEnd(event, reload)` mirrors Planning's:
`updateItem(activeId, { iteration })` where `iteration` is parsed from the drop
target's slot token (`backlog` → `null`), then `reload()`.

## Testing

**`lib/timeline.test.ts`**

- `groupByFeature`: buckets a feature's PI stories into backlog vs slots; orphan
  stories form the `null` lane; `showAll:false` hides backlog stories and
  backlog-only/empty features; `showAll:true` includes an empty in-PI feature and
  the backlog; lanes ignore other PIs.
- `dependencyComponent`: returns seeds + directly and transitively linked ids
  across both directions and both relation types; stops at unlinked items;
  handles an empty seed set (empty result).
- `layoutFlat`: places PI stories by iteration; features / other-PI / unplanned
  items go to backlog.

**Component tests (vitest)**

- `TimelineView` (feature mode): renders a feature lane with its stories in the
  correct iteration cells; the `Only planned` toggle removes the Backlog column
  and empty lanes; a drag onto a cell calls `updateItem` with the right
  `iteration` (and `null` for Backlog).
- `TimelineView` (dependencies mode): clicking cards selects them (ring) and the
  view narrows to the transitive component; `Clear` resets; hover still
  highlights partners.

## Scope guards (v1 — YAGNI)

- Single PI only (no cross-PI axis); other-PI dependency items appear in Backlog.
- Dependencies shown via badges + hover-highlight; **no drawn connector lines**.
- Features are lane headers / unscheduled — not draggable, no iteration.
- No new backend, schema, or API; everything derives from existing `items` +
  `links`.
- Team / assignee filters stay on the Planning board (not added here).
- In Dependencies mode a card click selects (does not open the drawer); drawer
  access for focused items is deferred.
- Build order: **By-feature mode first, then Dependencies mode.**
