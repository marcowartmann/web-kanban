# Modern Item Modals — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending spec review

## Goal

Give the item detail modals a modern Tailwind look: the **ItemDrawer** (the
right-docked panel that opens for a feature or story) and the **StoryBoardModal**
(a feature's "Stories" overlay board). Purely visual — **no new fields, no
behavior change**, all existing inputs / buttons / `aria-label`s / roles kept so
the current test suites keep passing.

## ItemDrawer

Stays a right-docked `aside` (`w-96`, `border-l`, `bg-white`, `shadow-xl`) so the
side-by-side panel stacking still works. Restructured into three regions:

- **Sticky header** (`sticky top-0`, subtle bottom border, white bg):
  - A **kind chip** colored by kind — feature = blue, story = slate, risk = red —
    showing `item.type ?? item.kind`; the `#id`; a **WSJF** badge (when
    `wsjf_score != null`); and a refined **close ✕** (`aria-label="Close"`).
  - The **title** as a prominent input (larger font, borderless until focus,
    `focus:ring`), bound to the same title draft value.
- **Scrolling body** (`flex-1 overflow-y-auto`, comfortable padding), grouped
  into sections. Each section = a small uppercase label + its content:
  - **Details:** Status, Planning Interval, Leading Team, Assignee (the existing
    `SearchableSelect`).
  - **Estimation:** Story Points, plus a **2-column grid** of Business Value /
    Time Criticality / Risk Reduction / Job Size.
  - **Stories** (features only): the child list as rounded, hoverable rows with
    click-to-open (when `onOpenChild`) + a remove `×` (`aria-label="remove story
    {id}"`); the section header shows the child count + an "Add story" button.
  - **Dependencies:** the existing links section (add relation + item picker,
    grouped current links with click-to-open + `aria-label="remove link {id}"`),
    lightly restyled to match (rounded rows, section header). Unchanged behavior.
  - The parent-feature link (for a story whose parent isn't already open) becomes
    a tidy card at the top of the body.
- **Sticky footer** (`border-t`, white bg): **Save** (primary blue, `rounded-lg`)
  + **Delete** (ghost red). Always visible while the body scrolls.

**Inputs.** The shared `Field` component is modernized: `rounded-lg`,
`border-gray-300`, `focus:border-blue-400 focus:ring-2 focus:ring-blue-100`,
roomier padding (`px-3 py-2`), and a refined label
(`text-xs font-medium text-gray-500`). Same props/behavior.

**Drawer shell refactor.** The `Drawer` helper becomes a flex-column `aside` that
renders a scrollable body slot plus an optional sticky **footer** slot (so the
Save/Delete row sits outside the scroll). The header is part of the drawer's
content (sticky within the scroll region). Error / loading states render a
minimal header + centered message, no footer.

## StoryBoardModal

- Overlay: keep the centered layout; `rounded-2xl`, softer shadow, a
  `backdrop-blur-sm` dimmed backdrop.
- **Header:** the feature title + a small **story-count chip**; a ghost
  **"Edit feature"** button, a primary **"+ Add story"** (`rounded-lg`), and a
  styled close ✕ (`aria-label="Close"`). Same handlers.
- **Empty state:** a friendlier centered message/card.
- The board **columns** (via `Column`) are unchanged.

## Non-goals / scope guards (v1)

- Visual only — no new fields (Description, Definition of Done, notes stay out),
  no data-model or API changes.
- The drawer stays docked (`w-96`) — not converted to a centered dialog — to keep
  side-by-side stacking.
- All existing `aria-label`s, button text ("Save", "Delete", "+ Add story", "Edit
  feature"), field labels, and roles are preserved.
- Board columns / card components untouched.

## Testing

- Behavior-preserving, so the existing suites are the safety net:
  `ItemDrawer.test`, `ItemDrawerAssignee.test`, `ItemDrawerStories.test`,
  `ItemDrawerLinks.test`, `StoryBoardModal.test` must all keep passing unchanged.
- No new logic to unit-test; the redesign is markup/Tailwind. Verify the full
  frontend suite + `tsc --noEmit` are clean, then screenshot both modals in the
  Docker stack (a feature drawer, a story drawer, and the Stories board).
- If any existing test asserts a class/structure that the restyle changes,
  update that assertion to the new markup (not the behavior).
