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
