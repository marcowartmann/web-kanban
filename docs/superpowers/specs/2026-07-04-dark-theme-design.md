# Dark Theme — Design

**Date:** 2026-07-04
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Add a user-selectable dark theme to the frontend alongside the existing light
theme, with a header toggle, system-preference default, and localStorage
persistence — without regressing the current light appearance.

## Decisions (from brainstorming)

1. **Strategy:** Semantic CSS-variable tokens (not per-element `dark:` variants).
2. **Toggle & default:** A UI toggle persisted in `localStorage`; on first visit
   (no saved choice) follow the OS `prefers-color-scheme`.
3. **Placement:** A sun/moon icon button in the top header.

## Architecture

### Theme mechanism

- The active theme lives as `data-theme="light" | "dark"` on the root
  `<html>` element (`document.documentElement`).
- **FOUC prevention:** an inline `<script>` in `index.html` runs before first
  paint and sets `data-theme` from `localStorage.theme`, falling back to
  `window.matchMedia('(prefers-color-scheme: dark)')`. This guarantees the
  correct theme is applied before React mounts, so there is no flash of the
  wrong theme.
- A React `ThemeProvider` (context) is the single source of truth at runtime.
  It initializes from the same rule as the inline script, exposes
  `{ theme, toggle }`, and on every change:
  - sets `document.documentElement.dataset.theme = theme`
  - writes `localStorage.theme = theme`
- `useTheme()` hook returns the context for consumers (the toggle button).

### Color system (in `frontend/src/index.css`)

Two coordinated parts layered on top of `@import "tailwindcss"`:

**a) Semantic surface tokens** — registered in an `@theme` block so they
generate real utilities:

| Token          | Utility        | Light value        | Dark value  |
| -------------- | -------------- | ------------------ | ----------- |
| `--color-canvas`  | `bg-canvas`  | `#f9fafb` (gray-50) | `#0b0f16`  |
| `--color-surface` | `bg-surface` | `#ffffff` (white)   | `#161c26`  |
| `--color-muted`   | `bg-muted`   | `#f3f4f6` (gray-100)| `#212a3a`  |

Light values equal today's colors exactly, so light mode is unchanged. Dark
values are provided as `[data-theme="dark"]` overrides of the same variables.

**b) Dark neutral ramp** — under `[data-theme="dark"]`, override Tailwind's
built-in `--color-gray-50 … --color-gray-900` variables with an *inverted*,
dark-optimized ramp. Because every `text-gray-*` / `border-gray-*` /
`bg-gray-*` utility in v4 compiles to `var(--color-gray-*)`, this flips them
all automatically **with zero markup changes**, and only under the dark
selector — light mode is untouched.

Representative dark ramp (exact values tuned during implementation for
contrast; primary text ≥ 7:1, secondary ≥ 4.5:1 on the surface):

```
--color-gray-50:  #0f1620;  /* was lightest → now darkest fill  */
--color-gray-100: #161e2b;
--color-gray-200: #212a3a;  /* borders                          */
--color-gray-300: #33405a;
--color-gray-400: #7c8aa5;  /* text-gray-400 = most-used muted  */
--color-gray-500: #94a3b8;
--color-gray-600: #b4c0d3;
--color-gray-700: #cbd5e1;  /* secondary text                   */
--color-gray-800: #e2e8f0;
--color-gray-900: #f1f5f9;  /* primary text → near-white        */
```

**Kept as-is:**
- `text-white` — used only on saturated colored buttons; must stay white, so
  `--color-white` is **not** remapped.
- Accent colors (blue/red/emerald buttons, WSJF/status badges). Spot-checked
  for contrast; only individual offenders get a targeted `dark:` tweak, which
  requires registering the dark variant:
  `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`
- Overlays: modal backdrop `bg-black/40`, `ring-black/5` — read fine on both.

### Refactor scope (surfaces only)

Only surfaces that cannot be handled by the ramp (white ≠ a gray step) are
edited to the new semantic utilities:

- `bg-white` → `bg-surface` (~56 occurrences: header, cards, modals, inputs,
  dropdown panels, admin cards).
- Root page `min-h-screen bg-gray-50` (App.tsx) → `bg-canvas`.
- Subtle panel fills `bg-gray-50` / `bg-gray-100` that act as surfaces (nav
  pill, drawer sidebar `bg-gray-50/60`, chips, hover targets) → `bg-muted`.
- Gradient/opacity one-offs (`bg-white/70`, `bg-white/60`, `to-white`) →
  surface-based equivalents (`bg-surface/70`, `to-surface`).

Everything else (text, borders, gray fills, accents) flips through the ramp.
Estimated ~70 targeted edits across the styled components + `ui.ts`.

### UI: theme toggle

- New `ThemeToggle` component: an icon button rendering a sun (in dark mode,
  "switch to light") or moon (in light mode, "switch to dark"), with an
  `aria-label` describing the target theme. `onClick={toggle}`.
- Mounted in the `App.tsx` header, left of the `UserMenu`, styled with the
  existing `btnGhost`/icon-button pattern.

## Components / files

- `frontend/index.html` — add pre-paint inline theme script.
- `frontend/src/theme/ThemeContext.tsx` — `ThemeProvider`, `useTheme`.
- `frontend/src/theme/theme.ts` — pure helpers: `readInitialTheme()`,
  `applyTheme(theme)` (shared logic, unit-testable without React).
- `frontend/src/components/ThemeToggle.tsx` — header button.
- `frontend/src/index.css` — `@theme` surface tokens, dark ramp override,
  `@custom-variant dark`.
- `frontend/src/main.tsx` — wrap app in `ThemeProvider` (alongside
  `AuthProvider`).
- `frontend/src/App.tsx` — root `bg-canvas`, header `bg-surface`, mount toggle.
- ~15 component files + `ui.ts` — `bg-white`/gray-surface → semantic utilities.

## Data flow

1. Browser parses `index.html` → inline script sets `data-theme` from
   localStorage/system before paint.
2. React mounts; `ThemeProvider` reads the same initial value, renders children.
3. User clicks `ThemeToggle` → `toggle()` flips `theme` → effect sets
   `dataset.theme` + writes localStorage.
4. CSS variables under `[data-theme="dark"]` cascade; all tokenized utilities
   restyle instantly. No reload.

## Error / edge handling

- `localStorage` unavailable (privacy mode): reads/writes wrapped in try/catch;
  fall back to in-memory + system preference. Never throw.
- Invalid stored value: treated as "no saved choice" → system default.
- SSR/no-`window`: not applicable (Vite SPA), but helpers guard `typeof window`.

## Testing

- `theme.ts` unit tests: `readInitialTheme()` returns stored value when present;
  falls back to system `prefers-color-scheme` when absent/invalid; `applyTheme`
  sets `documentElement.dataset.theme` and persists to localStorage.
- `ThemeContext` test: provider defaults from system on first load; `toggle`
  flips light↔dark, updates `data-theme`, and persists.
- `ThemeToggle` test: renders the correct affordance per theme, has a
  descriptive `aria-label`, and clicking flips the theme.
- Regression: full existing vitest suite stays green (no test asserts on
  neutral color classes — verified).
- Manual/Docker: build the frontend image, load the app, toggle, confirm
  persistence across reload and no FOUC.

## Out of scope

- Theming the backend or any server-rendered surface (none exists).
- Per-component theme overrides or additional themes beyond light/dark.
- Animating the theme transition.
