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
