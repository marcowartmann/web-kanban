import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "./api/client";
import { AppShell } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";

afterEach(() => vi.restoreAllMocks());

export function mockAppData(role: "admin" | "member" = "admin") {
  vi.spyOn(client, "getMe").mockResolvedValue(
    { id: 1, email: "u@x.ch", display_name: "U", role, team_id: 1, is_active: true } as never,
  );
  vi.spyOn(client, "getBoards").mockResolvedValue([] as never);
  vi.spyOn(client, "listItems").mockResolvedValue([] as never);
  vi.spyOn(client, "listLinks").mockResolvedValue([] as never);
  vi.spyOn(client, "getPlanningIntervals").mockResolvedValue([] as never);
  vi.spyOn(client, "getPersonOptions").mockResolvedValue([] as never);
  vi.spyOn(client, "getTeams").mockResolvedValue([] as never);
  vi.spyOn(client, "getContainers").mockResolvedValue([] as never);
  vi.spyOn(client, "getDepartments").mockResolvedValue([] as never);
  vi.spyOn(client, "getObjectiveLinkedFeatures").mockResolvedValue([] as never);
  vi.spyOn(client, "getProducts").mockResolvedValue([] as never);
  vi.spyOn(client, "getLifecycle").mockResolvedValue([] as never);
  vi.spyOn(client, "getContracts").mockResolvedValue([] as never);
  vi.spyOn(client, "listUsers").mockResolvedValue([] as never);
}

export function renderAt(path: string, role: "admin" | "member" = "admin") {
  mockAppData(role);
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppShell />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

it("deep link renders the Roadmap view", async () => {
  renderAt("/roadmap");
  expect(await screen.findByRole("link", { name: "Roadmap" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByText(/no streams yet/i)).toBeInTheDocument();
});

it("the root path lands on the Board", async () => {
  renderAt("/");
  expect(await screen.findByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
});

it("unknown paths land on the Board", async () => {
  renderAt("/nope");
  expect(await screen.findByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
});

it("members deep-linking to /admin are redirected to the Board", async () => {
  renderAt("/admin", "member");
  expect(await screen.findByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});

it("/admin redirects to the Users section", async () => {
  renderAt("/admin");
  expect(await screen.findByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { name: "Administration" })).toBeInTheDocument();
});

it("/admin/import deep-links to the Import section", async () => {
  renderAt("/admin/import");
  expect(await screen.findByRole("heading", { name: /import csv/i })).toBeInTheDocument();
});

it("unknown admin sections fall back to Users", async () => {
  renderAt("/admin/bogus");
  expect(await screen.findByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
});

const BOARD = {
  id: 1,
  name: "Features & Stories",
  kinds: ["feature", "story"],
  lanes: [],
} as never;

it("the Board page header holds New Feature / New Risk and Edit lanes", async () => {
  mockAppData("admin");
  vi.spyOn(client, "getBoards").mockResolvedValue([BOARD] as never);
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={["/board"]}>
          <AppShell />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
  expect(await screen.findByRole("button", { name: /new feature/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /new risk/i })).toBeInTheDocument();
  // Edit lanes only renders once the board list has loaded and an active
  // board is selected — the New Feature/Risk buttons mount immediately
  // (they don't depend on board data), so this needs its own wait.
  expect(await screen.findByRole("button", { name: "Edit lanes" })).toBeInTheDocument();
});

it("the New objective action is disabled until a team is chosen", async () => {
  mockAppData("admin");
  vi.spyOn(client, "getBoards").mockResolvedValue([BOARD] as never);
  vi.spyOn(client, "getTeams").mockResolvedValue([{ id: 1, name: "Network" }] as never);
  vi.spyOn(client, "getPIObjectives").mockResolvedValue([] as never);
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={["/board"]}>
          <AppShell />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: /pi objectives/i }));
  const btn = await screen.findByRole("button", { name: /new objective/i });
  expect(btn).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /team/i }));
  await userEvent.click(await screen.findByRole("option", { name: "Network" }));
  expect(screen.getByRole("button", { name: /new objective/i })).toBeEnabled();
});
