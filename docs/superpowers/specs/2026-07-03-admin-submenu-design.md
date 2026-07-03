# Admin Submenu (Left Sidebar) + Team-Scoped Capacity — Design

**Date:** 2026-07-03
**Status:** Approved (design gate) — pending spec review

## Context

The Admin page is one long scroll: Teams, Planning Intervals, Users, Audit Log,
Capacity, Snapshots stacked in a single column. The user wants the sections split
into submenus — chosen form (AskUserQuestion): **left sidebar**, the classic
enterprise admin layout. Additionally the capacity grid must be filterable by team.

## 1. AdminView layout (`frontend/src/components/admin/AdminView.tsx`)

Container widens `max-w-6xl` → `max-w-7xl` to make room for the sidebar. The
"Administration" header block stays on top. Below it, a two-column row:

```tsx
type AdminSection = "users" | "teams" | "intervals" | "snapshots" | "audit";

const SECTIONS: { id: AdminSection; label: string; icon: string }[] = [
  { id: "users", label: "Users", icon: "👤" },
  { id: "teams", label: "Teams & Capacity", icon: "👥" },
  { id: "intervals", label: "Planning Intervals", icon: "🗓️" },
  { id: "snapshots", label: "Snapshots", icon: "🗂️" },
  { id: "audit", label: "Audit Log", icon: "📜" },
];
```

- Wrapper: `<div className="flex items-start gap-6">`.
- Sidebar: `<nav aria-label="Admin sections" className="sticky top-8 w-52 shrink-0">`
  containing a `<ul className="flex flex-col gap-0.5">` of buttons:
  `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition
  focus:outline-none focus:ring-2 focus:ring-blue-100` + active
  `bg-blue-50 font-medium text-blue-700` / inactive `text-gray-600 hover:bg-gray-100`
  (the selected-popover-option idiom from ui.ts's language). Icon span is
  `aria-hidden`; the accessible name is the label text.
- Content: `<div className="min-w-0 flex-1">` rendering ONLY the active section
  (lazy mount — sections already fetch on mount, so each visit gets fresh data):
  - `users` (default) → `<UsersSection currentUserId={user.id} />`
  - `teams` → `<div className="flex flex-col gap-4">` with `TeamsSection` above
    `CapacitySection`. TeamsSection's `onChanged` additionally bumps a counter
    used as `key={capacityKey}` on CapacitySection, so team renames/deletes/creates
    remount the grid and its team filter options stay in sync.
  - `intervals` → `PlanningIntervalsSection`
  - `snapshots` → `SnapshotsSection`
  - `audit` → `AuditLogSection`
- Section order and default: as listed above; state is
  `useState<AdminSection>("users")`, not persisted.

The section components themselves keep their AdminCard chrome (icon chip, title,
count) — the sidebar adds navigation, it does not restyle the cards.

## 2. Team filter for capacity (`frontend/src/components/admin/CapacitySection.tsx`)

- Fetch teams alongside people/capacities: `void getTeams().then(setTeams);` in the
  existing mount effect; `const [teams, setTeams] = useState<Team[]>([]);`.
- Filter state: `const [teamFilter, setTeamFilter] = useState<string | undefined>();`
  (team NAME, matching FilterSelect's string API; backend enforces unique names).
- Derived rows:

```tsx
const selectedTeam = teams.find((t) => t.name === teamFilter);
const visiblePeople = teamFilter
  ? selectedTeam
    ? people.filter((p) => p.team_id === selectedTeam.id)
    : []
  : people;
```

- Header rework: the right-hand controls group becomes
  `<div className="ml-auto flex flex-wrap items-center gap-2.5">` holding
  1. `<FilterSelect label="Team" value={teamFilter} options={teams.map((t) => t.name)}
     onChange={setTeamFilter} />` (import from `../FilterSelect`; default allLabel "All"),
  2. the existing "Planning Interval" caption + PI pills (unchanged, minus their
     own `ml-auto`).
- Table body maps `visiblePeople` instead of `people`. Empty row text:
  `teamFilter ? "No people in this team yet." : "No people yet."` (colSpan unchanged).
- Grid cells, commit-on-blur logic, and PI pills are otherwise untouched.

## Out of scope

- No routing/URL persistence for the active section (plain component state).
- No restyling of the section cards; no changes to UsersSection, TeamsSection,
  PlanningIntervalsSection, SnapshotsSection, AuditLogSection internals.
- The Planning view's own capacity narrowing is untouched (it already filters).
- Backend: no changes.

## Testing

- **AdminView.test.tsx**
  - Existing "adds a team" test: after render, first click the sidebar button
    "Teams & Capacity", then fill/submit as today (Users is now the default view).
  - New: "sidebar switches sections" — default shows the Users card
    (`+ Add person` visible, snapshots empty-state absent); click "Snapshots" →
    snapshots empty state appears and `+ Add person` is gone.
- **CapacitySection.test.tsx**
  - Existing tests gain a `getTeams` mock (`mockResolvedValue([])`).
  - New: "filters member rows by team" — people
    `[{id 1, Marco, team_id 1}, {id 2, Zoe, team_id 2}]`, teams
    `[{1 Network}, {2 Cloud}]`; open the Team FilterSelect, choose "Network" →
    Marco's capacity row remains, Zoe's disappears; choosing "All" restores both.
- Verification: `npx tsc --noEmit` + `npx vitest run` green from `frontend/`;
  rebuild the frontend container; visually verify sidebar switching and the team
  filter against the live stack (read-only; no data mutations).
