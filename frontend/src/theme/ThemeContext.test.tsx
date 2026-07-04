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
