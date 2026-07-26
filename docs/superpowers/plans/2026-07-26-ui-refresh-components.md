# UI Refresh B — Component System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's ~20 chip maps, ~20 empty states, ~14 error variants, 4 loading variants, 8 pill() copies, and two diverging drawer families with eight shared primitives, per `docs/superpowers/specs/2026-07-26-ui-refresh-components-design.md`.

**Architecture:** Primitives first (Badge, Banner, EmptyState, Skeleton set, SegmentedToggle/TogglePill, TabBar, Menu, DrawerShell), then adoption sweeps per family. Strict normalization: one chip shape (`rounded-full`, `-50/-700` tints), one z-ladder (popover 20 / drawer 40 / modal 50 / confirm 60), Escape closes everything except a dirty ItemDrawer, and the two cross-product tables become click-to-edit.

**Tech Stack:** React 18 + TS + Tailwind v4, Vitest + Testing Library, FA Pro duotone via `src/icons.ts`.

## Global Constraints

- Branch: `feat/ui-components`, created off `main` in Task 1.
- FontAwesome token before any npm/docker build: `export FONTAWESOME_PACKAGE_TOKEN=$(tr -d '\n' < frontend/.fa-token)` from repo root. Never echo it.
- Icons only via `frontend/src/icons.ts`; router imports from `"react-router"`; never native `<select>`/`window.confirm`; never append a conflicting `px-*`/`py-*` to a ui.ts token.
- Chip test assertions target visible text, never class strings; adoption tasks preserve every existing assertion (adapt queries only where the DOM legitimately changed).
- Badge tones are limited to `gray | blue | emerald | amber | red | violet | indigo | sky` — the families whose `-50` tints are dark-remapped in `index.css`. No new `dark:` utilities anywhere.
- CWD discipline: npm/npx from `frontend/`, git from repo root. Full suite green after every task (`npm run test`; 436 tests at branch start). Known noise: UsersSection.test.tsx logs 7 pre-existing unhandled-rejection errors — judge by pass/fail counts.
- The five catalog drawers are Service/Component/System/Contract/RoadmapItem — "catalog drawers" always means exactly these.

---

### Task 1: Badge primitive + catalog-side adoption

**Files:**
- Create: `frontend/src/components/Badge.tsx`, `frontend/src/components/Badge.test.tsx`
- Modify: `frontend/src/components/RiskBadge.tsx`, `ContractBadge.tsx`, `ProductDetail.tsx` (BADGE map + stage chip ×2), `LifecycleView.tsx:84` (stage chip), `RoadmapView.tsx` (STATUS_CLASSES split), `RoadmapItemDrawer.tsx` (status chips if any — check), `ServiceDrawer.tsx:262-263` (dep/criticality chips), `RankingView.tsx` (DeltaBadge green→emerald)

**Interfaces:**
- Produces: `Badge({ tone, strike?, children }: { tone: BadgeTone; strike?: boolean; children: ReactNode })` default export; `export type BadgeTone = "gray" | "blue" | "emerald" | "amber" | "red" | "violet" | "indigo" | "sky"`. Later tasks import both.

- [ ] **Step 0: Create the branch**

```bash
cd /Users/marco/Coding/web-kanban && git checkout -b feat/ui-components
```

- [ ] **Step 1: Failing tests** — `frontend/src/components/Badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Badge from "./Badge";

it("renders the tone's soft pill classes", () => {
  render(<Badge tone="emerald">active</Badge>);
  const el = screen.getByText("active");
  expect(el).toHaveClass("rounded-full", "bg-emerald-50", "text-emerald-700");
});

it("strike renders line-through gray text over any tone", () => {
  render(<Badge tone="blue" strike>cancelled</Badge>);
  const el = screen.getByText("cancelled");
  expect(el).toHaveClass("line-through", "text-gray-400");
  expect(el).not.toHaveClass("text-blue-700");
});
```

(The one deliberate exception to "no class assertions": the primitive's own contract IS its classes; adopters never assert classes.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/Badge.test.tsx` — FAIL (module missing).

- [ ] **Step 3: Implement** — `frontend/src/components/Badge.tsx`:

```tsx
import type { ReactNode } from "react";

export type BadgeTone = "gray" | "blue" | "emerald" | "amber" | "red" | "violet" | "indigo" | "sky";

// -50/-700 is the dark-safe pairing: every -50 tint is remapped in index.css.
const TONE: Record<BadgeTone, string> = {
  gray: "bg-gray-100 text-gray-600",
  blue: "bg-blue-50 text-blue-700",
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  violet: "bg-violet-50 text-violet-700",
  indigo: "bg-indigo-50 text-indigo-700",
  sky: "bg-sky-50 text-sky-700",
};

/** The one status/kind chip. Strict shape: soft rounded-full pill. */
export default function Badge({
  tone,
  strike = false,
  children,
}: {
  tone: BadgeTone;
  strike?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
        strike ? "bg-gray-100 text-gray-400 line-through" : TONE[tone]
      }`}
    >
      {children}
    </span>
  );
}
```

(gray uses `bg-gray-100 text-gray-600` — the existing neutral-chip idiom; gray-100 is dark-remapped.)

Run Step 1 tests — PASS.

- [ ] **Step 4: Adopt on the catalog side** (each site: replace the styled `<span>`/map with Badge; keep the visible text identical):

1. `RiskBadge.tsx` — becomes a wrapper:

```tsx
import Badge, { type BadgeTone } from "./Badge";
import type { RiskLevel } from "../types";

const TONE: Record<Exclude<RiskLevel, "ok">, BadgeTone> = { warning: "amber", danger: "red" };

/** EoL/EoS risk pill; renders nothing when the risk is "ok". */
export default function RiskBadge({ risk }: { risk: RiskLevel }) {
  if (risk === "ok") return null;
  return <Badge tone={TONE[risk]}>{risk}</Badge>;
}
```

2. `ContractBadge.tsx` — same shape: `const TONE: Record<Exclude<ContractStatus, "active">, BadgeTone> = { expiring: "amber", expired: "red" };`, render `<Badge tone={TONE[status]}>{status}</Badge>`.
3. `ProductDetail.tsx` — the `BADGE: Record<LifecycleState, string>` map (top of file) becomes `const SERVICE_TONE: Record<LifecycleState, BadgeTone> = { planned: "blue", active: "emerald", deprecated: "amber", retired: "gray" };` and its render site uses `<Badge tone={SERVICE_TONE[...]}>`. The two inline stage chips (`rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600` in ComponentRow and SystemRow) become `<Badge tone="gray">{…}</Badge>`.
4. `LifecycleView.tsx:83-87` — stage chip cell becomes `<Badge tone="gray">{c.lifecycle_stage}</Badge>`.
5. `RoadmapView.tsx` — `STATUS_CLASSES` splits in two, because the Gantt **bars are not chips** (documented deviation from the spec's table; a `-50` bar would vanish against the lane):

```tsx
// Bar fills stay -100 with -700 text (dark-remapped tints; fixes the old
// -800/gray-200 dark-mode gaps). Chips elsewhere use <Badge>.
const BAR_CLASSES: Record<RoadmapStatus, string> = {
  idea: "bg-gray-100 text-gray-700",
  planned: "bg-blue-100 text-blue-700",
  committed: "bg-violet-100 text-violet-700",
  done: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-gray-100 text-gray-400 line-through",
};
```

Rename the usage on the bar button; export `export const ROADMAP_STATUS_TONE: Record<RoadmapStatus, BadgeTone> = { idea: "gray", planned: "blue", committed: "violet", done: "emerald", cancelled: "gray" };` for chip renderings (check `RoadmapItemDrawer.tsx` for a status chip/select decoration — if none renders a chip, the export simply stays unused until one does; remove it in that case).
6. `ServiceDrawer.tsx:262-263` — dep-type chip (`rounded-full bg-gray-200 px-1.5 text-xs text-gray-600`) → `<Badge tone="gray">`; criticality chip (`bg-amber-50 text-amber-700`) → `<Badge tone="amber">`.
7. `RankingView.tsx` DeltaBadge — stays text-only (not a Badge) but `text-green-600` → `text-emerald-600`.

- [ ] **Step 5: Fix test fallout + run**

Existing tests assert visible text (e.g. "warning", "active", stage names) — they keep passing; adapt any test that asserted a class string by switching it to a text/role assertion (do not delete the test). Run: `npx vitest run src/components` then `npm run test` — green.

- [ ] **Step 6: Commit**

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): Badge primitive + catalog chip adoption"
```

---

### Task 2: Badge adoption — board/work side

**Files:**
- Modify: `frontend/src/components/Card.tsx` (kindStyles + risk_scope + Stories button stays), `ItemDrawer.tsx` (KIND_CHIP, WSJF chip, story status/SP chips), `StoryBoardModal.tsx` (header chips), `admin/UsersSection.tsx` (statusPill + auth chip), `PlanningColumn.tsx` (load chip), `ObjectiveCard.tsx` (key-delivery chip)

**Interfaces:**
- Consumes: `Badge`, `BadgeTone` from Task 1.

- [ ] **Step 1: Adopt, site by site** (visible text stays identical everywhere):

1. `Card.tsx:7-11` — `kindStyles` becomes `const KIND_TONE: Record<string, BadgeTone> = { feature: "blue", risk: "red", story: "gray" };`; the kind chip (`rounded-sm px-1.5 py-0.5 text-xs`) becomes `<Badge tone={KIND_TONE[card.kind] ?? "gray"}>{card.type ?? card.kind}</Badge>` — the sanctioned visible change to soft pills. The risk_scope chip (`Card.tsx:47-57`) becomes `<Badge tone={card.risk_scope === "art" ? "amber" : "gray"}>{card.risk_scope === "art" ? "ART" : "Team"}</Badge>`. The "Stories (n)" button and WSJF text (`text-xs font-semibold text-gray-600`) are not chips — untouched.
2. `ItemDrawer.tsx:35-39` — `KIND_CHIP` becomes the same `KIND_TONE` mapping used with Badge in the sticky header (`ItemDrawer.tsx:629-633`); `KIND_BAND` (gradient) untouched. WSJF chip (`ItemDrawer.tsx:642-646`, `bg-amber-100/80 … text-amber-700`) → `<Badge tone="amber">WSJF {item.wsjf_score}</Badge>`. Story-row status chip (`:473`, ring style) → `<Badge tone="gray">…</Badge>`; SP chip (`:478`, slate) → `<Badge tone="gray">…</Badge>`.
3. `StoryBoardModal.tsx:103-115` — header "Feature" chip → `<Badge tone="blue">Feature</Badge>`; stories-count chip (ring style) → `<Badge tone="gray">{…} stories</Badge>`; WSJF chip → `<Badge tone="amber">WSJF {…}</Badge>`.
4. `admin/UsersSection.tsx:9-12` — `statusPill` map → tones `{ active: "emerald", inactive: "amber" }` via Badge; auth-provider chip (`:115-121`) → tones `{ ldap: "indigo", oidc: "violet", local: "gray" }`.
5. `PlanningColumn.tsx:48-51` — load chip: over → `<Badge tone="red">…</Badge>`, under → `<Badge tone="gray">…</Badge>` (the `bg-surface` variant folds into gray).
6. `ObjectiveCard.tsx:37-39` — key-delivery chip → `<Badge tone="amber"><FontAwesomeIcon icon={faStar} aria-hidden /> Key delivery…</Badge>` (Badge is `inline-flex gap-1`, the icon slots in; keep the exact current label text).

- [ ] **Step 2: Test fallout + run**

Same rule as Task 1: text assertions survive; class-string assertions (if any) convert to text/role. Run `npm run test` — green; `npm run build` — clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): Badge adoption across board, drawers, and admin chips"
```

---

### Task 3: Banner + EmptyState + adoption

**Files:**
- Create: `frontend/src/components/Banner.tsx` + `Banner.test.tsx`, `frontend/src/components/EmptyState.tsx` + `EmptyState.test.tsx`
- Modify (Banner): `RoadmapView.tsx:167-171`, `CatalogSection.tsx:112`, `ProductDetail.tsx` (services error), the five catalog drawers' error divs, `admin/UsersSection.tsx:85`, `LoginPage.tsx:89`, `UserMenu.tsx:131`, `UserModal.tsx:236`, `admin/DepartmentsSection.tsx:88`, `admin/TeamsSection.tsx:99`, `admin/PlanningIntervalsSection.tsx:110`, `admin/ContainersSection.tsx:243`, `admin/SnapshotsSection.tsx:113-114`, `admin/BackupSection.tsx:157-158`, `admin/LdapSection.tsx:137-138`, `ItemComments.tsx:186`, `ItemDrawer.tsx:682` (amber conflict), `ImportButton.tsx:126` (amber), `StoryBoardModal.tsx:151`, **plus new error handling in `LifecycleView.tsx` + `ContractsView.tsx`**
- Modify (EmptyState): `ProductsView.tsx:50`, `LifecycleView.tsx:57`, `ContractsView.tsx:57`, `RoadmapView.tsx:177`, `TimelineView.tsx` (no-match), `ProductDetail.tsx` (4 tab empties), `admin/AdminCard.tsx` (`adminEmptyClass` sites keep working — swap the class for the component in TeamsSection/PlanningIntervalsSection/ContainersSection/DepartmentsSection/SnapshotsSection), `admin/BackupSection.tsx:163`

**Interfaces:**
- Produces: `Banner({ tone, children }: { tone: "error" | "success" | "warning"; children: ReactNode })`; `EmptyState({ children, action }: { children: ReactNode; action?: ReactNode })`.

- [ ] **Step 1: Failing tests**

```tsx
// Banner.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Banner from "./Banner";

it("error tone renders a red banner with role alert", () => {
  render(<Banner tone="error">Save failed</Banner>);
  const el = screen.getByRole("alert");
  expect(el).toHaveTextContent("Save failed");
  expect(el).toHaveClass("bg-red-50", "text-red-700");
});

it("success and warning tones", () => {
  render(<Banner tone="success">Saved</Banner>);
  expect(screen.getByText("Saved")).toHaveClass("bg-emerald-50");
});
```

```tsx
// EmptyState.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import EmptyState from "./EmptyState";

it("renders the message and optional action", () => {
  render(<EmptyState action={<button>Add one</button>}>No streams yet.</EmptyState>);
  expect(screen.getByText("No streams yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add one" })).toBeInTheDocument();
});
```

Run both files — FAIL.

- [ ] **Step 2: Implement**

```tsx
// Banner.tsx
import type { ReactNode } from "react";

const TONE = {
  error: "bg-red-50 text-red-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
} as const;

/** Inline feedback banner. tone="error" announces via role=alert. */
export default function Banner({
  tone,
  children,
}: {
  tone: keyof typeof TONE;
  children: ReactNode;
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${TONE[tone]}`}>
      {children}
    </div>
  );
}
```

```tsx
// EmptyState.tsx
import type { ReactNode } from "react";

/** View/tab-level empty state. Keep wordings at the call site. */
export default function EmptyState({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="py-12 text-center text-sm text-gray-400">
      <div>{children}</div>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
```

Run Step 1 tests — PASS.

- [ ] **Step 3: Adoption sweep**

Banner: replace every listed error/success/warning rendering with `<Banner tone="…">{text}</Banner>`, keeping each site's outer spacing by wrapping (`<div className="mb-3">…` etc.) only where the old class carried a margin — margins live OUTSIDE the component. LifecycleView + ContractsView gain error handling:

```tsx
const [error, setError] = useState<string | null>(null);
useEffect(() => {
  void getLifecycle()          // getContracts() in ContractsView
    .then(setRows)
    .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
    .finally(() => setLoading(false));
}, []);
// in JSX, above the table area:
{error && <div className="mb-3"><Banner tone="error">{error}</Banner></div>}
```

EmptyState: replace each listed empty rendering with `<EmptyState>{existing wording verbatim}</EmptyState>` (ProductsView keeps its longer wording; the `adminEmptyClass` swap keeps AdminCard's other exports intact and deletes `adminEmptyClass` once unused). NOT converted: drawer sub-list "None" `<li>`s, SearchableSelect "No matches", admin `<td colSpan>` empties, TimelineLane "No feature", StoryBoardModal's two-line empty (bespoke, stays).

- [ ] **Step 4: Run + commit**

`npm run test` green (empty/error wordings unchanged ⇒ text assertions survive; adapt structure-sensitive queries only).

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): Banner + EmptyState primitives adopted app-wide"
```

---

### Task 4: Skeleton set + loading sweep

**Files:**
- Create: `frontend/src/components/Skeleton.tsx` + `Skeleton.test.tsx`
- Modify: `BoardPage.tsx` ("Loading board…"), `ProductsView.tsx`, `ProductDetailPage.tsx` ("Loading…"), `ProductDetail.tsx` (4 tabs get loading state), `LifecycleView.tsx`, `ContractsView.tsx`, `RoadmapView.tsx`, `ItemDrawer.tsx:174` (body load), `admin/UsersSection.tsx`, `admin/SnapshotsSection.tsx`, `admin/AuditLogSection.tsx`
- Test: extend `RoadmapView.test.tsx` with the A-deferred add-stream tests (this task touches its loading branch anyway)

**Interfaces:**
- Produces: `Skeleton({ className })`, `SkeletonRows({ rows = 5 })`, `SkeletonCards({ count = 6 })`, `SkeletonBoard({ columns = 4 })` — all named exports from `Skeleton.tsx`.

- [ ] **Step 1: Failing test**

```tsx
// Skeleton.test.tsx
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { Skeleton, SkeletonRows } from "./Skeleton";

it("pulses only when motion is allowed", () => {
  const { container } = render(<Skeleton className="h-4" />);
  expect(container.firstElementChild).toHaveClass("motion-safe:animate-pulse", "bg-gray-100");
});

it("SkeletonRows renders the requested count with a loading label", () => {
  const { getAllByTestId, getByLabelText } = render(<SkeletonRows rows={3} />);
  expect(getByLabelText("Loading")).toBeInTheDocument();
  expect(getAllByTestId("skeleton-row")).toHaveLength(3);
});
```

Run — FAIL.

- [ ] **Step 2: Implement** — `frontend/src/components/Skeleton.tsx`:

```tsx
/** Loading placeholders. Gray-ramp colors are dark-remapped; motion-safe
 *  respects prefers-reduced-motion. Containers carry aria-label="Loading". */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`motion-safe:animate-pulse rounded bg-gray-100 ${className}`} />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-label="Loading" role="status" className="flex flex-col gap-2 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-testid="skeleton-row">
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div aria-label="Loading" role="status" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

export function SkeletonBoard({ columns = 4 }: { columns?: number }) {
  return (
    <div aria-label="Loading" role="status" className="flex gap-4 px-6 pt-4">
      {Array.from({ length: columns }, (_, i) => (
        <div key={i} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-gray-100 p-3">
          <Skeleton className="h-5 w-24 bg-gray-200" />
          <Skeleton className="h-20 bg-gray-200" />
          <Skeleton className="h-20 bg-gray-200" />
        </div>
      ))}
    </div>
  );
}
```

Run — PASS.

- [ ] **Step 3: Sweep**

| Site | Replacement |
|---|---|
| BoardPage `Loading board…` | `<SkeletonBoard />` |
| ProductsView `Loading…` | `<SkeletonCards />` |
| ProductDetailPage `Loading…` | keep the padded wrapper, content `<SkeletonRows rows={6} />` |
| ProductDetail tabs | each tab tracks `loaded` (services already have `load()`; add a boolean flipped in `.finally`) and shows `<SkeletonRows />` until first data |
| LifecycleView / ContractsView / RoadmapView `Loading…` | `<SkeletonRows />` |
| ItemDrawer body `Loading…` (:174) | `<div className="p-6"><SkeletonRows rows={6} /></div>` |
| UsersSection / SnapshotsSection / AuditLogSection | add a `loading` boolean around their initial fetch; `<SkeletonRows />` inside the card while true |

Planning/Timeline/Ranking: no change (prop-fed, no fetch of their own).

- [ ] **Step 4: A-deferred RoadmapView tests** (added here — this task edits the same file):

```tsx
it("add-stream row closes after a successful create", async () => {
  // reuse the file's stream mocks; createStream resolves
  render(<RoadmapView />);
  await userEvent.click(await screen.findByRole("button", { name: /add stream/i }));
  await userEvent.type(screen.getByPlaceholderText("New stream name"), "Edge{Enter}");
  await waitFor(() => expect(screen.queryByPlaceholderText("New stream name")).not.toBeInTheDocument());
});

it("add-stream row stays open when the create fails", async () => {
  vi.mocked(client.createStream).mockRejectedValueOnce(new Error("boom"));
  render(<RoadmapView />);
  await userEvent.click(await screen.findByRole("button", { name: /add stream/i }));
  await userEvent.type(screen.getByPlaceholderText("New stream name"), "Edge{Enter}");
  expect(await screen.findByRole("alert")).toBeInTheDocument();      // Banner from Task 3
  expect(screen.getByPlaceholderText("New stream name")).toBeInTheDocument();
});
```

(Match the file's existing mocking idiom — it may spy rather than `vi.mocked`; keep its style.)

- [ ] **Step 5: Run + commit**

`npm run test` green.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): skeleton loading states across views, tabs, and admin"
```

---

### Task 5: SegmentedToggle + TogglePill + adoption

**Files:**
- Create: `frontend/src/components/SegmentedToggle.tsx` + `SegmentedToggle.test.tsx`, `frontend/src/components/TogglePill.tsx` + `TogglePill.test.tsx`
- Modify: `TimelineView.tsx` (Mode + Lanes), `Toolbar.tsx` (Kind pills), `PlanningView.tsx` (pill() + Unassigned/Capacity), `LifecycleView.tsx` ("Only at risk"), `ContractsView.tsx` ("Only expiring or expired"), `admin/ContainersSection.tsx` (PI pill row), `admin/CapacitySection.tsx` (PI pill row)

**Interfaces:**
- Produces:

```tsx
SegmentedToggle<T extends string>({ options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; ariaLabel: string })
TogglePill({ active, onChange, children }: { active: boolean; onChange: (next: boolean) => void; children: ReactNode })
```

- [ ] **Step 1: Failing tests**

```tsx
// SegmentedToggle.test.tsx
it("renders a radiogroup and switches on click", async () => {
  const onChange = vi.fn();
  render(<SegmentedToggle ariaLabel="Mode" value="feature" onChange={onChange}
    options={[{ value: "feature", label: "By feature" }, { value: "deps", label: "Dependencies" }]} />);
  const group = screen.getByRole("radiogroup", { name: "Mode" });
  expect(within(group).getByRole("radio", { name: "By feature" })).toHaveAttribute("aria-checked", "true");
  await userEvent.click(within(group).getByRole("radio", { name: "Dependencies" }));
  expect(onChange).toHaveBeenCalledWith("deps");
});
```

```tsx
// TogglePill.test.tsx
it("toggles with aria-pressed", async () => {
  const onChange = vi.fn();
  render(<TogglePill active={false} onChange={onChange}>Only at risk</TogglePill>);
  const btn = screen.getByRole("button", { name: "Only at risk" });
  expect(btn).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(btn);
  expect(onChange).toHaveBeenCalledWith(true);
});
```

Run — FAIL.

- [ ] **Step 2: Implement** (one shared class source):

```tsx
// TogglePill.tsx
import type { ReactNode } from "react";

export const pillClass = (active: boolean) =>
  `rounded-full border px-3 py-1 text-sm font-medium transition focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
    active
      ? "border-blue-600 bg-blue-600 text-white shadow-xs"
      : "border-gray-200 bg-surface text-gray-600 hover:bg-gray-50"
  }`;

/** Single on/off filter pill. */
export default function TogglePill({
  active,
  onChange,
  children,
}: {
  active: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={() => onChange(!active)} className={pillClass(active)}>
      {children}
    </button>
  );
}
```

```tsx
// SegmentedToggle.tsx
import { pillClass } from "./TogglePill";

/** Exclusive pill group (radiogroup semantics). */
export default function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex items-center gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={pillClass(value === o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

Run — PASS.

- [ ] **Step 3: Adoption**

- `TimelineView.tsx`: Mode pair → `<SegmentedToggle ariaLabel="Mode" value={mode} onChange={setMode} options={[{value:"feature",label:"By feature"},{value:"deps",label:"Dependencies"}]} />` (keep the caption span and the conditional `Clear (n)` button beside it — the Clear button becomes `<TogglePill active={false} onChange={() => setSelected(new Set())}>Clear ({selected.size})</TogglePill>`); Lanes pair → SegmentedToggle over a `showAll ? "all" : "planned"` mapping. Delete the local `pill()`.
- `Toolbar.tsx:118-135`: each Kind button → `<TogglePill active={active} onChange={() => toggleKind(kind)}>{label}</TogglePill>` (multi-select stays — TogglePill per kind; aria-pressed semantics preserved).
- `PlanningView.tsx`: `pill()` deleted; Unassigned + Capacity → TogglePill.
- `LifecycleView.tsx` / `ContractsView.tsx`: `pill()` deleted; the one toggle each → TogglePill.
- `admin/ContainersSection.tsx:194-219` + `admin/CapacitySection.tsx:97-122`: the inline PI pill rows become `<SegmentedToggle ariaLabel="Planning Interval" …>` over the PI values (exclusive selection — matches current behavior; keep the caption span).
- `ProductDetail.tsx` keeps its `pill()` until Task 6 replaces its tabs entirely.

- [ ] **Step 4: Run + commit**

Existing pill tests query by role button + name — TogglePill keeps that; SegmentedToggle changes role to radio: update those queries (e.g. Timeline "By feature" `role: "radio"`). No assertion deletions. `npm run test` green.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): SegmentedToggle + TogglePill replace all pill() copies"
```

---

### Task 6: TabBar + BoardTabs/ProductDetail adoption

**Files:**
- Create: `frontend/src/components/TabBar.tsx` + `TabBar.test.tsx`
- Modify: `frontend/src/components/BoardTabs.tsx`, `frontend/src/components/ProductDetail.tsx` (pill tabs → TabBar; delete its `pill()`)

**Interfaces:**
- Produces: `TabBar({ tabs, active, onSelect }: { tabs: { key: string; label: ReactNode }[]; active: string | null; onSelect: (k: string) => void })` — underline idiom, `role="tablist"`/`role="tab"` + `aria-selected`.

- [ ] **Step 1: Failing test**

```tsx
it("renders tabs with the active underline and selects on click", async () => {
  const onSelect = vi.fn();
  render(<TabBar active="b" onSelect={onSelect}
    tabs={[{ key: "a", label: "Services" }, { key: "b", label: "Systems" }]} />);
  expect(screen.getByRole("tab", { name: "Systems" })).toHaveAttribute("aria-selected", "true");
  await userEvent.click(screen.getByRole("tab", { name: "Services" }));
  expect(onSelect).toHaveBeenCalledWith("a");
});
```

- [ ] **Step 2: Implement**

```tsx
import type { ReactNode } from "react";

/** In-view secondary navigation: the underline-tab idiom. */
export default function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: string; label: ReactNode }[];
  active: string | null;
  onSelect: (k: string) => void;
}) {
  return (
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-gray-200 bg-surface px-6">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === active}
          onClick={() => onSelect(t.key)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            t.key === active
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Adopt**

- `BoardTabs.tsx` — becomes a thin mapper: boards + optional objectives entry map to `tabs` (`key: String(board.id)` / `"objectives"`), `active` = `objectivesActive ? "objectives" : String(activeId)`, `onSelect` dispatches to `onSelect(Number(k))` or `onSelectObjectives()`. Public props unchanged.
- `ProductDetail.tsx` — the `mb-5 flex gap-2` pill row becomes `<div className="mb-5 -mx-6"><TabBar tabs={[{key:"services",label:"Services"},{key:"systems",label:"Systems"},{key:"components",label:"Components"},{key:"contracts",label:"Contracts"}]} active={tab} onSelect={(k) => setTab(k as Tab)} /></div>` (negative margin so the underline spans the content width like BoardTabs; delete the local `pill()`).

- [ ] **Step 4: Run + commit**

Tab queries in existing tests move from `role: "button"` to `role: "tab"` where they clicked tabs (BoardTabs tests, ProductDetail/tab tests, App.routes PI-objectives test clicks "PI Objectives" — now a tab). `npm run test` green.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): TabBar underline idiom for BoardTabs and ProductDetail"
```

---

### Task 7: Menu primitive + StreamMenu/UserMenu adoption

**Files:**
- Create: `frontend/src/components/Menu.tsx` + `Menu.test.tsx`
- Modify: `frontend/src/components/RoadmapView.tsx` (StreamMenu → Menu), `frontend/src/components/UserMenu.tsx` (items via Menu)
- Test: extend `RoadmapView.test.tsx` with A-deferred kebab tests

**Interfaces:**
- Produces:

```tsx
export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean };
Menu({ trigger, items, ariaLabel }: {
  trigger: (props: { open: boolean }) => ReactNode;  // rendered inside the trigger button
  items: MenuItem[];
  ariaLabel: string;
})
```

Behavior contract: trigger button carries `aria-haspopup="menu"`, `aria-expanded`, `aria-label={ariaLabel}`; popover `role="menu"` + `popoverClass` at `z-20`; outside-mousedown + Escape close; ArrowDown/ArrowUp move focus (wrapping), Home/End jump, Enter/Space select, Escape returns focus to the trigger; disabled items are focus-skipped; `danger` renders the red item style.

- [ ] **Step 1: Failing tests**

```tsx
// Menu.test.tsx
function renderMenu(items?: Partial<MenuItem>[]) {
  const onSelect = vi.fn();
  render(<Menu ariaLabel="Stream actions" trigger={() => <span>⋮</span>}
    items={[
      { label: "Move up", onSelect, disabled: true },
      { label: "Rename", onSelect },
      { label: "Delete", onSelect, danger: true },
    ]} />);
  return onSelect;
}

it("opens with the full menu contract and selects with Enter", async () => {
  const onSelect = renderMenu();
  const trigger = screen.getByRole("button", { name: "Stream actions" });
  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
  await userEvent.keyboard("{ArrowDown}");                    // skips disabled → Rename
  expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(onSelect).toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("Escape closes and returns focus to the trigger", async () => {
  renderMenu();
  const trigger = screen.getByRole("button", { name: "Stream actions" });
  await userEvent.click(trigger);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
```

- [ ] **Step 2: Implement** — `frontend/src/components/Menu.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { popoverClass } from "./ui";

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean };

/** Accessible popover menu: outside-click/Escape close, arrow-key roving
 *  focus (disabled items skipped), focus returns to the trigger on close. */
export default function Menu({
  trigger,
  items,
  ariaLabel,
}: {
  trigger: (props: { open: boolean }) => ReactNode;
  items: MenuItem[];
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const enabled = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.disabled);
  const focusAt = (pos: number) => {
    const target = enabled[(pos + enabled.length) % enabled.length];
    if (target) itemRefs.current[target.i]?.focus();
  };
  const currentPos = () =>
    enabled.findIndex(({ i }) => itemRefs.current[i] === document.activeElement);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); close(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); focusAt(currentPos() + 1); }
    if (e.key === "ArrowUp") { e.preventDefault(); focusAt(currentPos() - 1); }
    if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    if (e.key === "End") { e.preventDefault(); focusAt(enabled.length - 1); }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (open && e.key === "Escape") { e.stopPropagation(); close(true); }
          if (!open && e.key === "ArrowDown") { e.preventDefault(); setOpen(true); }
        }}
        className="rounded-lg px-1.5 py-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
      >
        {trigger({ open })}
      </button>
      {open && (
        <div role="menu" onKeyDown={onMenuKeyDown} className={`absolute left-0 z-20 mt-1 w-44 ${popoverClass}`}>
          {items.map((it, i) => (
            <button
              key={it.label}
              ref={(el) => { itemRefs.current[i] = el; }}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { close(true); it.onSelect(); }}
              className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                it.danger ? "text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

(If the ArrowDown-after-click focus test needs it, focus the first enabled item when the menu opens via keyboard; keep click-open leaving focus on the trigger — both are valid menu patterns, the tests above only require arrow navigation to work from the trigger.)

- [ ] **Step 3: Adopt**

- `RoadmapView.tsx`: delete the local `StreamMenu` component; the gutter renders

```tsx
<Menu
  ariaLabel={`Stream actions for ${stream.name}`}
  trigger={() => <FontAwesomeIcon icon={faEllipsisVertical} />}
  items={[
    { label: "Move up", disabled: index === 0, onSelect: () => void moveStream(index, -1) },
    { label: "Move down", disabled: index === streams.length - 1, onSelect: () => void moveStream(index, 1) },
    { label: "Rename", onSelect: () => setRenaming({ id: stream.id, name: stream.name }) },
    { label: "Delete", danger: true, onSelect: () => setConfirmDelete({ id: stream.id, name: stream.name }) },
  ]}
/>
```

- `UserMenu.tsx`: keep the avatar trigger button and header block; convert its two entries to Menu? — **No**: UserMenu's popover carries a non-item header block that the Menu contract doesn't model. Instead UserMenu adopts only the keyboard behavior it lacks: add ArrowDown/ArrowUp focus movement between its two `role="menuitem"` buttons and focus-return-to-trigger on Escape (mirror Menu's handler shape inline). Popover stays as-is otherwise. (Documented deviation: full Menu adoption for UserMenu would need a header-slot feature — YAGNI.)

- [ ] **Step 4: A-deferred kebab tests** (RoadmapView.test.tsx):

```tsx
it("Move down is disabled for the last stream", async () => {
  render(<RoadmapView />);
  await userEvent.click(await screen.findByRole("button", { name: "Stream actions for Datacenter" }));
  expect(screen.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
});

it("delete via the kebab shows the confirm and cancel keeps the stream", async () => {
  render(<RoadmapView />);
  await userEvent.click(await screen.findByRole("button", { name: "Stream actions for Campus" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Campus")).toBeInTheDocument();
});
```

(Use the stream names the file's mocks actually define; if they differ, keep the file's fixtures.)

- [ ] **Step 5: Run + commit**

`npm run test` green (existing kebab tests keep passing — trigger aria-label and menuitem names unchanged).

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): accessible Menu primitive; roadmap kebab + user menu keyboard support"
```

---

### Task 8: Z-ladder + modal Escape sweep

**Files:**
- Modify: `frontend/src/components/ui.ts` (Z constants + comment), `ConfirmDialog.tsx` (z-50→z-60 — wait: Tailwind has no z-60 by default; use arbitrary `z-[60]`), `StoryBoardModal.tsx` (z-20→z-50 + Escape), `UserModal.tsx` (Escape), `ObjectiveEditor.tsx` (Escape), `UserMenu.tsx` (password modal Escape), `ImportButton.tsx` (Escape, ignored while importing)

**Interfaces:**
- Produces: in `ui.ts`:

```ts
/** Z ladder: content popovers < drawer overlays < modals < ConfirmDialog. */
export const zPopover = "z-20";
export const zDrawer = "z-40";
export const zModal = "z-50";
export const zConfirm = "z-[60]";
```

- [ ] **Step 1: Failing tests** — add to each modal's existing test file (StoryBoardModal, UserModal, ObjectiveEditor, ImportButton) a test in the file's own render idiom:

```tsx
it("Escape closes the modal", async () => {
  // file's standard render with onClose spy
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalled();
});
```

ImportButton additionally: while `busy` (mock a pending import), Escape does NOT call onClose.

- [ ] **Step 2: Implement**

Escape pattern for modals (they're focus-containing overlays; a document-level listener is the reliable jsdom + real-world route). In each modal component:

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [onClose]);
```

(ImportButton wraps the handler: `e.key === "Escape" && !busy && onClose()`. UserMenu's password modal closes via `setChanging(false)` — its existing Escape handler at UserMenu.tsx:27 currently only closes the popover; extend it: `if (e.key === "Escape") { setOpen(false); setChanging(false); }`.)

Z updates: ConfirmDialog `${overlayClass} z-50` → `` `${overlayClass} ${zConfirm}` ``; StoryBoardModal overlay `z-20` → `${zModal}` (import from ui.ts); catalog drawers already `z-40` (switch the literal to `${zDrawer}` opportunistically ONLY in files this task already touches — the rest happens in Task 9's DrawerShell); ItemDrawer overlay in `shell/WorkLayout.tsx` `z-30` → `${zDrawer}` (import).

- [ ] **Step 3: Run + commit**

`npm run test` green (ConfirmDialog-over-drawer behavior unchanged — z-[60] > z-40).

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): documented z-ladder; Escape closes every modal"
```

---

### Task 9: DrawerShell + five catalog drawers

**Files:**
- Create: `frontend/src/components/DrawerShell.tsx` + `DrawerShell.test.tsx`
- Modify: `ServiceDrawer.tsx`, `ComponentDrawer.tsx`, `SystemDrawer.tsx`, `ContractDrawer.tsx`, `RoadmapItemDrawer.tsx`

**Interfaces:**
- Consumes: `zDrawer` from Task 8, `closeButtonClass` + button tokens from ui.ts, `faXmark` from icons.ts.
- Produces:

```tsx
DrawerShell({
  title, headerExtra, onClose, footer, children,
}: {
  title: string;
  headerExtra?: ReactNode;
  onClose: () => void;
  footer: {
    onDelete?: () => void;      // omitted in create mode → left slot renders <span />
    deleteLabel?: string;       // default "Delete"
    onCancel: () => void;
    onSave: () => void;
    saveLabel?: string;         // default "Save"
    saving?: boolean;           // disables Save
  };
  children: ReactNode;
})
```

- [ ] **Step 1: Failing tests**

```tsx
// DrawerShell.test.tsx — helpers: renderShell(footerOverrides?)
it("renders title, backdrop, and the Delete|Cancel+Save footer order", async () => {
  const f = renderShell({ onDelete: vi.fn() });
  const buttons = screen.getAllByRole("button");
  // order: close ✕ (header), Delete, Cancel, Save
  expect(buttons.map((b) => b.textContent)).toEqual(["", "Delete", "Cancel", "Save"]);
});

it("Escape and backdrop click close; panel clicks do not", async () => {
  const { onClose } = renderShell();
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByTestId("drawer-backdrop"));
  expect(onClose).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole("heading"));
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("create mode (no onDelete) renders no Delete button", () => {
  renderShell({ onDelete: undefined });
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Implement** — `frontend/src/components/DrawerShell.tsx`:

```tsx
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, type ReactNode } from "react";
import { faXmark } from "../icons";
import { btnDangerGhost, btnPrimary, btnSecondary, closeButtonClass, zDrawer } from "./ui";

/** Shared right-docked drawer: backdrop, Escape, ✕, Delete|Cancel+Save footer. */
export default function DrawerShell({
  title,
  headerExtra,
  onClose,
  footer,
  children,
}: {
  title: string;
  headerExtra?: ReactNode;
  onClose: () => void;
  footer: {
    onDelete?: () => void;
    deleteLabel?: string;
    onCancel: () => void;
    onSave: () => void;
    saveLabel?: string;
    saving?: boolean;
  };
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="drawer-backdrop"
      className={`fixed inset-0 ${zDrawer} bg-black/40 backdrop-blur-xs`}
      onClick={onClose}
    >
      <aside
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-y-0 right-0 flex w-[26rem] flex-col border-l border-gray-200 bg-surface shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-5">
          <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-gray-900">
            <span className="truncate">{title}</span>
            {headerExtra}
          </h2>
          <button onClick={onClose} aria-label="Close" className={closeButtonClass}>
            <FontAwesomeIcon icon={faXmark} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
          {footer.onDelete ? (
            <button onClick={footer.onDelete} className={btnDangerGhost}>
              {footer.deleteLabel ?? "Delete"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button onClick={footer.onCancel} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={footer.onSave} disabled={footer.saving} className={btnPrimary}>
              {footer.saveLabel ?? "Save"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Adopt in the five catalog drawers**

Each drawer keeps ALL state/handlers/body fields and swaps its shell: the outer `<aside className="fixed inset-y-0 right-0 z-40 …">`, the header div (title + ✕ glyph), and the bottom footer block are replaced by

```tsx
return (
  <DrawerShell
    title={component == null ? "New component" : "Edit component"}   // per drawer
    headerExtra={/* ServiceDrawer: its RiskBadge; others: none */}
    onClose={onClose}
    footer={{
      onDelete: component == null ? undefined : () => setConfirmDelete(true),
      onCancel: onClose,
      onSave: () => void save(),
    }}
  >
    {/* existing error Banner + body fields, unchanged */}
  </DrawerShell>
);
```

ConfirmDialog usage inside each drawer stays (it's above the backdrop at z-[60]). The old `✕` glyphs, per-drawer footer blocks, and `z-40` literals disappear. Sub-list `✕` remove buttons inside drawer bodies are NOT part of this task (they're body content; C's glyph sweep).

- [ ] **Step 4: Test fallout + run**

Drawer tests that clicked the `✕` by text now use `role: "button", name: "Close"`; footer-order/backdrop/Escape behavior is covered by DrawerShell tests — per-drawer tests keep their save/delete/link assertions. `npm run test` green; `npm run build` clean.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): DrawerShell with backdrop+Escape adopted by all catalog drawers"
```

---

### Task 10: ItemDrawer behavior alignment

**Files:**
- Modify: `frontend/src/components/ItemDrawer.tsx` (footer order at :605-622, Escape-unless-dirty in its internal `Drawer` wrapper at :860-880)
- Test: `frontend/src/components/ItemDrawer.test.tsx` (or the file that covers the drawer — locate with `grep -l "ItemDrawer" src/components/*.test.tsx`)

**Interfaces:**
- Consumes: the existing `dirty` boolean (ItemDrawer.tsx:607) and `onClose` prop.

- [ ] **Step 1: Failing tests** (in the drawer's test file, using its existing render/mocks):

```tsx
it("footer renders Delete on the far left and Save on the right", async () => {
  renderDrawer();
  const footer = (await screen.findByRole("button", { name: "Delete" })).closest("div")!;
  const labels = within(footer).getAllByRole("button").map((b) => b.textContent);
  expect(labels[0]).toBe("Delete");
  expect(labels[labels.length - 1]).toBe("Save");
});

it("Escape closes a clean drawer but not a dirty one", async () => {
  const { onClose } = renderDrawer();
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("Escape is ignored while there are unsaved changes", async () => {
  const { onClose } = renderDrawer();
  await userEvent.type(await screen.findByLabelText("Title"), " more");
  await userEvent.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Implement**

Footer (`ItemDrawer.tsx:605-622`) reorders to:

```tsx
      footer={
        <div className="flex items-center gap-3">
          <button
            onClick={() => setConfirmingDelete(true)}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
          >
            Delete
          </button>
          {dirty && <span className="ml-auto text-xs text-gray-400">Unsaved changes</span>}
          <button
            onClick={save}
            disabled={!dirty}
            className={`${dirty ? "" : "ml-auto"} rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-200 disabled:cursor-default disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none`}
          >
            Save
          </button>
        </div>
      }
```

(When clean, Save takes `ml-auto`; when dirty, the indicator does — Save stays rightmost either way.)

Escape: in the internal `Drawer` wrapper (the component rendering the `w-104`/`w-160` panel), add

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !dirty) onClose();
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [dirty, onClose]);
```

— pass `dirty` and `onClose` into `Drawer` as props if it doesn't already receive them. Note the stacked-panels case: each open ItemDrawer registers its own listener, so one Escape closes every *clean* panel at once — acceptable (panels are independent), but `e.stopPropagation()` is useless on document listeners, so simply accept the all-clean-close semantics and assert single-panel behavior in tests only.

- [ ] **Step 3: Run + commit**

`npm run test` green.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): ItemDrawer delete moves left; Escape closes unless dirty"
```

---

### Task 11: Table shell + row-click editing on Lifecycle/Contracts

**Files:**
- Modify: `frontend/src/components/ui.ts` (thClass + tdClass tokens), `LifecycleView.tsx`, `ContractsView.tsx`, `admin/SnapshotsSection.tsx` + `admin/BackupSection.tsx` (header alignment to thClass)
- Test: `LifecycleView.test.tsx`, `ContractsView.test.tsx`

**Interfaces:**
- Consumes: `ComponentDrawer({ component, productId, onClose, onChanged })` and `ContractDrawer({ contract, productId, onClose, onChanged })` — both already self-fetch their option lists (`getVendors`, `getLifecycle`), so cross-product edit mode works; `Component.product_id` / `SupportContract.product_id` exist in types.ts.
- Produces: in ui.ts —

```ts
export const thClass =
  "px-3 py-2 border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-400";
export const tdClass = "px-3 py-2 border-b border-gray-100";
```

- [ ] **Step 1: Failing tests**

```tsx
// LifecycleView.test.tsx (reuse the file's getLifecycle mocks)
it("clicking a row opens the component drawer for editing", async () => {
  render(<LifecycleView />);
  await userEvent.click(await screen.findByRole("button", { name: "9300-48P" }));
  expect(await screen.findByRole("heading", { name: "Edit component" })).toBeInTheDocument();
});

it("saving from the drawer refetches the list", async () => {
  render(<LifecycleView />);
  await userEvent.click(await screen.findByRole("button", { name: "9300-48P" }));
  await userEvent.click(await screen.findByRole("button", { name: "Save" }));
  await waitFor(() => expect(client.getLifecycle).toHaveBeenCalledTimes(2));
});
```

(ContractsView.test.tsx mirrors with "test-contract" / "Edit contract" / getContracts. Adapt fixture names to what each file's mocks define; ComponentDrawer's `getVendors` needs a mock. If updateComponent isn't mocked, mock it resolving.)

- [ ] **Step 2: Implement**

LifecycleView:

```tsx
const [editing, setEditing] = useState<Component | null>(null);
const reload = () => getLifecycle().then(setRows);
// tr gains interactivity; name cell becomes a button:
<tr
  key={c.id}
  onClick={() => setEditing(c)}
  className="cursor-pointer transition hover:bg-gray-50"
>
  <td className={tdClass}>
    <button className="text-left font-medium text-gray-800 hover:underline" onClick={(e) => { e.stopPropagation(); setEditing(c); }}>
      {c.name}
    </button>
    {c.model && <div className="text-xs text-gray-400">{c.model}</div>}
  </td>
  …
</tr>
// after the table:
{editing && (
  <ComponentDrawer
    component={editing}
    productId={editing.product_id}
    onClose={() => setEditing(null)}
    onChanged={async () => { await reload(); }}
  />
)}
```

All `<th>` swap their literal for `thClass`, all `<td>` for `tdClass`. ContractsView identical with `ContractDrawer` + `contract={editing}`; its Yearly-cost column right-aligns: `<th className={`${thClass} text-right`}>` / `<td className={`${tdClass} text-right tabular-nums`}>` (composing alignment utilities is sanctioned — no conflict inside the tokens). Same for ProductDetail's contracts totals if trivially reachable — otherwise skip (C).
Admin alignment: SnapshotsSection.tsx:124 and BackupSection.tsx:168 header rows switch from `text-xs … font-medium` to `thClass` on their `th`s (keep their table-specific extras). Admin rows stay non-clickable.

- [ ] **Step 3: Run + commit**

`npm run test` green; `npm run build` clean.

```bash
cd /Users/marco/Coding/web-kanban && git add frontend && git commit -m "feat(ui): shared table tokens; lifecycle/contracts rows open their edit drawers"
```

---

### Task 12: Test hygiene, stack verification + docs

**Files:**
- Modify: `frontend/src/App.auth.test.tsx` (history reset), `frontend/src/components/ProductsView.test.tsx` (stray blank line), `CLAUDE.md`, `.superpowers/sdd/progress.md` (ledger append — gitignored, not committed)

- [ ] **Step 1: Hygiene fixes**

`App.auth.test.tsx` — add below the imports:

```tsx
beforeEach(() => window.history.replaceState(null, "", "/"));
```

(import `beforeEach` from vitest). Delete the stray blank line at `ProductsView.test.tsx:70`.

- [ ] **Step 2: Full verification**

```bash
cd /Users/marco/Coding/web-kanban/frontend && npm run build && npm run test
cd ../backend && . .venv/bin/activate && pytest -q     # expect 465 passed
cd .. && export FONTAWESOME_PACKAGE_TOKEN=$(tr -d '\n' < frontend/.fa-token)
docker compose build frontend && docker compose up -d
```

Playwright walkthrough at http://localhost:8080 (read-only; no data mutations): all nine views light + dark — chips/badges readable in both; skeletons appear on a hard reload of Lifecycle/Products (or verified by component tests if too fast); open each catalog drawer (backdrop visible, Escape closes, footer order Delete|Cancel Save); ItemDrawer: Escape closes clean, type in title → Escape ignored → revert via ✕; Lifecycle row-click opens Edit component, Cancel; Contracts row-click opens Edit contract, Cancel; roadmap kebab keyboard: open, ArrowDown, Escape returns focus; ProductDetail underline tabs; StoryBoardModal Escape. No stray screenshots/.playwright-mcp at repo root afterwards.

- [ ] **Step 3: Docs**

CLAUDE.md frontend conventions bullet (the "Custom dropdown components are deliberate" sentence) extends to name the new primitives: Badge/Banner/EmptyState/Skeleton set/SegmentedToggle/TogglePill/TabBar/Menu/DrawerShell, the z-ladder tokens, and the rule "status chips are `<Badge>` — never hand-rolled spans". Ledger: append a "UI Refresh B — Component System" section to `.superpowers/sdd/progress.md` with the task-completion lines.

- [ ] **Step 4: Commit**

```bash
cd /Users/marco/Coding/web-kanban && git add frontend CLAUDE.md && git commit -m "docs+test: component-system conventions; test hygiene fixes"
```
