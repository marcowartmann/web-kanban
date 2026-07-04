# Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-selectable dark theme with a header toggle, system-preference default, and localStorage persistence, without regressing the light theme.

**Architecture:** Theme is `data-theme="light|dark"` on `<html>`, set pre-paint by an inline script and mirrored at runtime by a React `ThemeProvider`. Colors flip via CSS variables in `index.css`: two semantic surface tokens (`canvas`, `surface`) plus a dark override of Tailwind's built-in `--color-gray-*` ramp. `text-white` and accent colors are untouched.

**Tech Stack:** React 18 + TypeScript + Vite 5, Tailwind CSS v4.3 (CSS-variable theming), vitest + @testing-library/react (jsdom).

## Global Constraints

- Tailwind v4: color utilities compile to `var(--color-*)`, so overriding those variables under a selector re-themes them. Use `:root[data-theme="dark"]` (specificity beats `:root`) for overrides.
- Do **not** remap `--color-white` — `text-white` must stay white on colored buttons.
- Light mode must be byte-for-byte unchanged: only add tokens (light values = current colors) and dark-scoped overrides.
- Persist an explicit choice to `localStorage.theme`; on first visit (no/invalid stored value) follow `prefers-color-scheme`. Never persist the system-derived default until the user toggles.
- Wrap all `localStorage`/`matchMedia` access in try/catch or guards — never throw.
- Refinement of spec: the spec listed a third `muted` token; it is dropped (YAGNI). Gray fills (`bg-gray-50/100`) ride the ramp, which yields correct dark depth (`canvas` < gray fills < `surface`).

---

### Task 1: Theme helper module

**Files:**
- Create: `frontend/src/theme/theme.ts`
- Test: `frontend/src/theme/theme.test.ts`

**Interfaces:**
- Produces: `type Theme = "light" | "dark"`; `systemTheme(): Theme`; `readInitialTheme(): Theme`; `applyTheme(theme: Theme): void`; `persistTheme(theme: Theme): void`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/theme/theme.test.ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTheme, persistTheme, readInitialTheme, systemTheme } from "./theme";

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it("systemTheme reflects prefers-color-scheme", () => {
  mockMatchMedia(true);
  expect(systemTheme()).toBe("dark");
  mockMatchMedia(false);
  expect(systemTheme()).toBe("light");
});

it("readInitialTheme prefers a valid stored value", () => {
  mockMatchMedia(true); // system says dark
  localStorage.setItem("theme", "light");
  expect(readInitialTheme()).toBe("light");
});

it("readInitialTheme falls back to system when unset or invalid", () => {
  mockMatchMedia(true);
  expect(readInitialTheme()).toBe("dark");
  localStorage.setItem("theme", "bogus");
  expect(readInitialTheme()).toBe("dark");
});

it("applyTheme sets the root data-theme attribute", () => {
  applyTheme("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  applyTheme("light");
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("persistTheme writes to localStorage", () => {
  persistTheme("dark");
  expect(localStorage.getItem("theme")).toBe("dark");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/theme/theme.test.ts`
Expected: FAIL — cannot resolve `./theme`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/theme/theme.ts
export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

function safeGet(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  try {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function readInitialTheme(): Theme {
  const stored = safeGet();
  if (stored === "light" || stored === "dark") return stored;
  return systemTheme();
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode / storage disabled — ignore */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/theme/theme.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/theme/theme.ts frontend/src/theme/theme.test.ts
git commit -m "feat(theme): theme resolution/persistence helpers"
```

---

### Task 2: ThemeProvider + useTheme, wired into main

**Files:**
- Create: `frontend/src/theme/ThemeContext.tsx`
- Test: `frontend/src/theme/ThemeContext.test.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `Theme`, `readInitialTheme`, `applyTheme`, `persistTheme` from `./theme`.
- Produces: `ThemeProvider({ children })`; `useTheme(): { theme: Theme; toggle: () => void }`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/theme/ThemeContext.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} data-testid="probe">
      {theme}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, // system = light
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

it("defaults to the system theme and sets data-theme", () => {
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId("probe")).toHaveTextContent("light");
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("toggle flips the theme, updates data-theme, and persists", async () => {
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await userEvent.click(screen.getByTestId("probe"));
  expect(screen.getByTestId("probe")).toHaveTextContent("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("theme")).toBe("dark");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/theme/ThemeContext.test.tsx`
Expected: FAIL — cannot resolve `./ThemeContext`.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/theme/ThemeContext.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { applyTheme, persistTheme, readInitialTheme, type Theme } from "./theme";

interface ThemeValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = () =>
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      persistTheme(next);
      return next;
    });

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/theme/ThemeContext.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wrap the app in ThemeProvider**

In `frontend/src/main.tsx`, import the provider and wrap it **outside** `AuthProvider` (so the theme is set even on the login screen):

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 6: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/theme/ThemeContext.tsx frontend/src/theme/ThemeContext.test.tsx frontend/src/main.tsx
git commit -m "feat(theme): ThemeProvider/useTheme and app wiring"
```

---

### Task 3: CSS tokens, dark ramp, and pre-paint FOUC script

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/index.html`

**Interfaces:**
- Produces: `bg-canvas` / `bg-surface` (+ `text-*`/`border-*` variants) utilities; a `dark:` variant; dark-mode variable overrides.

- [ ] **Step 1: Replace `index.css` contents**

```css
@import "tailwindcss";

/* Enables `dark:` utilities for the few accent tweaks that need them. */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* Semantic surface tokens. Light values equal the pre-dark-theme colors,
   so light mode is unchanged. */
@theme {
  --color-canvas: #f9fafb; /* was bg-gray-50 (page)   */
  --color-surface: #ffffff; /* was bg-white (cards)    */
}

/* Dark theme: override surface tokens + invert Tailwind's gray ramp.
   `:root[data-theme="dark"]` outranks `:root`, so these win when active.
   `--color-white` is deliberately NOT overridden (text-white stays white). */
:root[data-theme="dark"] {
  --color-canvas: #0b0f16;
  --color-surface: #1c2534;

  --color-gray-50: #10161f;
  --color-gray-100: #161e29;
  --color-gray-200: #263041; /* borders   */
  --color-gray-300: #364155;
  --color-gray-400: #7d8ba3; /* most-used muted text */
  --color-gray-500: #97a3b8;
  --color-gray-600: #b6c1d2;
  --color-gray-700: #ccd5e2; /* secondary text */
  --color-gray-800: #e3e8ef;
  --color-gray-900: #f2f5f9; /* primary text   */
}
```

- [ ] **Step 2: Add the pre-paint theme script to `index.html`**

Insert this `<script>` inside `<head>`, **before** the module script, so `data-theme` is set before first paint (no flash):

```html
    <script>
      (function () {
        try {
          var t = localStorage.getItem("theme");
          if (t !== "light" && t !== "dark") {
            t = window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light";
          }
          document.documentElement.dataset.theme = t;
        } catch (e) {}
      })();
    </script>
```

Resulting `<head>`:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SAFe Kanban</title>
    <script>
      (function () {
        try {
          var t = localStorage.getItem("theme");
          if (t !== "light" && t !== "dark") {
            t = window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light";
          }
          document.documentElement.dataset.theme = t;
        } catch (e) {}
      })();
    </script>
  </head>
```

- [ ] **Step 3: Verify the build compiles and utilities exist**

Run: `cd frontend && npm run build`
Expected: build succeeds; `dist/assets/*.css` contains `--color-canvas` and `:root[data-theme="dark"]`. Verify:

Run: `cd frontend && grep -c "data-theme=\"dark\"\|--color-canvas" dist/assets/*.css`
Expected: a non-zero count.

- [ ] **Step 4: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/index.css frontend/index.html
git commit -m "feat(theme): dark CSS variables + pre-paint theme script"
```

---

### Task 4: ThemeToggle button + header wiring + canvas backgrounds

**Files:**
- Create: `frontend/src/components/ThemeToggle.tsx`
- Test: `frontend/src/components/ThemeToggle.test.tsx`
- Modify: `frontend/src/App.tsx` (mount toggle; root `bg-gray-50` → `bg-canvas`)
- Modify: `frontend/src/auth/AuthContext.tsx` (loading `bg-gray-50` → `bg-canvas`)

**Interfaces:**
- Consumes: `useTheme` from `../theme/ThemeContext`; `btnGhost` from `./ui`.
- Produces: default-exported `ThemeToggle` component.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ThemeToggle.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme/ThemeContext";
import ThemeToggle from "./ThemeToggle";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, // start light
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

it("offers switching to dark while in light mode, and flips on click", async () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  const btn = screen.getByRole("button", { name: /switch to dark theme/i });
  await userEvent.click(btn);
  expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeInTheDocument();
  expect(document.documentElement.dataset.theme).toBe("dark");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ThemeToggle.test.tsx`
Expected: FAIL — cannot resolve `./ThemeToggle`.

- [ ] **Step 3: Write the component**

```tsx
// frontend/src/components/ThemeToggle.tsx
import { useTheme } from "../theme/ThemeContext";
import { btnGhost } from "./ui";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`${btnGhost} text-lg leading-none`}
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ThemeToggle.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Mount the toggle and switch page backgrounds to `bg-canvas`**

In `frontend/src/App.tsx`:
- Add `import ThemeToggle from "./components/ThemeToggle";`.
- Change the root wrapper `className="min-h-screen bg-gray-50"` → `className="min-h-screen bg-canvas"`.
- In the header's right-hand controls, render `<ThemeToggle />` immediately before `<UserMenu ... />`. Example (match the existing header structure):

```tsx
<div className="flex items-center gap-2">
  <ThemeToggle />
  <UserMenu user={user} onLoggedOut={() => setUser(null)} />
</div>
```

In `frontend/src/auth/AuthContext.tsx`, change the loading placeholder
`<div className="min-h-screen bg-gray-50" />` → `<div className="min-h-screen bg-canvas" />`.

- [ ] **Step 6: Verify the suite still passes**

Run: `cd frontend && npm test`
Expected: all tests pass (prior count + 8 new theme tests). The 12 pre-existing jsdom "Invalid URL" fetch errors are unrelated noise.

- [ ] **Step 7: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add frontend/src/components/ThemeToggle.tsx frontend/src/components/ThemeToggle.test.tsx frontend/src/App.tsx frontend/src/auth/AuthContext.tsx
git commit -m "feat(theme): header theme toggle + canvas page backgrounds"
```

---

### Task 5: Refactor surfaces to `bg-surface` and verify end-to-end

**Files:**
- Modify: every `frontend/src/**/*.tsx` and `frontend/src/components/ui.ts` containing `bg-white` or `to-white` (header, cards, modals, inputs, dropdowns, admin cards, `ui.ts` constants).

**Interfaces:**
- Consumes: `bg-surface` utility (Task 3). No new exports.

- [ ] **Step 1: Replace white surfaces with the semantic token**

Because `bg-white` must become the themeable surface everywhere (including `hover:bg-white`, `focus:bg-white`, and opacity forms like `bg-white/70`), do a substring replacement of `bg-white` → `bg-surface` and `to-white` → `to-surface` across `frontend/src` (excluding tests, which assert no color classes):

```bash
cd /Users/marco/Coding/web-kanban/frontend
grep -rl --include=*.tsx --include=*.ts -e 'bg-white' -e 'to-white' src \
  | grep -v '\.test\.' \
  | xargs sed -i '' -e 's/bg-white/bg-surface/g' -e 's/to-white/to-surface/g'
```

Note: `text-white` is intentionally untouched (it contains no `bg-white`/`to-white` substring), so button label colors stay white.

- [ ] **Step 2: Confirm no stray `bg-white`/`to-white` remain and white text is intact**

Run: `cd frontend && grep -rn --include=*.tsx --include=*.ts -e 'bg-white' -e 'to-white' src | grep -v '\.test\.'`
Expected: no output.

Run: `cd frontend && grep -rc 'text-white' src | grep -v ':0' | head`
Expected: still present (unchanged).

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npm run build`
Expected: `tsc` clean, Vite build succeeds.

- [ ] **Step 4: Full test suite**

Run: `cd frontend && npm test`
Expected: all tests pass (no test asserts on `bg-white`).

- [ ] **Step 5: Docker + visual verification**

```bash
cd /Users/marco/Coding/web-kanban
docker compose build frontend && docker compose up -d frontend
```

Open the app, and using the header toggle verify in **both** themes:
- Page background (`bg-canvas`) is clearly darker than cards/header (`bg-surface`) in dark mode.
- The nav pill's selected tab (`bg-surface`) is distinguishable from the pill track (`bg-gray-100`).
- Primary text is near-white, muted labels are legible, borders are visible.
- Colored buttons (blue/red) keep **white** label text.
- Reload the page — the chosen theme persists with no flash of the wrong theme.

If any accent badge/button reads poorly on dark (e.g. a light-tinted `bg-*-100` chip), fix only that element with a targeted `dark:` utility, e.g. `dark:bg-blue-500/15 dark:text-blue-300`. Re-run `npm run build` and `npm test` after any such tweak.

- [ ] **Step 6: Commit**

```bash
cd /Users/marco/Coding/web-kanban
git add -A
git commit -m "feat(theme): tokenize white surfaces as bg-surface for dark mode"
```

---

## After all tasks

Use **superpowers:finishing-a-development-branch**: verify `npm test` green, then present merge/PR/keep/discard options.

## Self-Review notes

- **Spec coverage:** mechanism/data-theme (Task 3 + Task 2), FOUC script (Task 3), ThemeProvider + system-default + persistence (Tasks 1–2), surface tokens + dark ramp + keep-white + accents (Tasks 3, 5), refactor scope (Tasks 4–5), header toggle (Task 4), testing (all tasks + Task 5 Docker). The spec's `muted` token is intentionally dropped (documented under Global Constraints).
- **Type consistency:** `Theme`, `readInitialTheme`, `applyTheme`, `persistTheme`, `systemTheme`, `useTheme`, `ThemeProvider`, `ThemeToggle` are used identically across tasks.
- **No placeholders:** every code/command step is concrete.
