import { render, screen, waitFor } from "@testing-library/react";
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

// The sidebar's nav links exist from the very first render (static markup);
// react-router only attaches aria-current="page" once the route/redirect has
// settled a beat later. `findByRole` resolves as soon as an element matching
// role+name exists, *not* once its attributes reach a given state — so
// `findByRole(...).toHaveAttribute(...)` checks the attribute exactly once,
// right after the link first appears, and can observe it pre-settle. Under
// full-suite parallel load the settle beat can land after that single check,
// flaking an otherwise-correct assertion (raising findByRole's own timeout
// does not help, since it isn't what's being waited on). Poll the attribute
// itself instead.
async function expectCurrentNavLink(name: string) {
  await waitFor(
    () => expect(screen.getByRole("link", { name })).toHaveAttribute("aria-current", "page"),
    { timeout: 3000 },
  );
}

it("deep link renders the Roadmap view", async () => {
  renderAt("/roadmap");
  await expectCurrentNavLink("Roadmap");
  expect(await screen.findByText(/no streams yet/i)).toBeInTheDocument();
});

it("the root path lands on the Board", async () => {
  renderAt("/");
  await expectCurrentNavLink("Board");
});

it("unknown paths land on the Board", async () => {
  renderAt("/nope");
  await expectCurrentNavLink("Board");
});

it("members deep-linking to /admin are redirected to the Board", async () => {
  renderAt("/admin", "member");
  await expectCurrentNavLink("Board");
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});

it("/admin redirects to the Users section", async () => {
  renderAt("/admin");
  await expectCurrentNavLink("Users");
  expect(screen.getByRole("heading", { name: "Administration" })).toBeInTheDocument();
});

it("/admin/import deep-links to the Import section", async () => {
  renderAt("/admin/import");
  expect(await screen.findByRole("heading", { name: /import csv/i })).toBeInTheDocument();
});

it("unknown admin sections fall back to Users", async () => {
  renderAt("/admin/bogus");
  await expectCurrentNavLink("Users");
});

const BOARD = {
  id: 1,
  name: "Features & Stories",
  kinds: ["feature", "story"],
  lanes: [],
} as never;

const FEATURE_ITEM = {
  id: 9, kind: "feature", type: "Feature", parent_id: null, position: 0, version: 1,
  title: "Feat Solo", status: "Analyzing", description: null, kategorie: null, art: null,
  sdi_prio: null, tshirt_size: null, wsjf_score: null, story_points: null,
  planning_interval: null, iteration: null, leading_team: null, supporting_team: null,
  container_id: null, externer_partner: null, assignee: null, assignee_id: null,
  akzeptanzkriterien: null, bo_stakeholder: null, business_value: null,
  time_criticality: null, risk_reduction: null, cost_of_delay: null, job_size: null,
  definition_of_done: null, children: [],
} as never;

// Regression for the modal-over-drawer z-ladder bug: opening any item panel
// (here, StoryBoardModal's "Edit feature") must close the Stories modal
// first — otherwise the panel renders behind it (drawer z-40 < modal z-50)
// and is invisible even though it's "open".
it("opening an item panel from the Stories modal closes the modal instead of hiding behind it", async () => {
  mockAppData("admin");
  vi.spyOn(client, "getBoards").mockResolvedValue([BOARD] as never);
  vi.spyOn(client, "listItems").mockResolvedValue([FEATURE_ITEM] as never);
  vi.spyOn(client, "getItem").mockResolvedValue(FEATURE_ITEM);
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={["/board"]}>
          <AppShell />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );

  await userEvent.click(await screen.findByRole("button", { name: /stories \(0\)/i }));
  expect(await screen.findByRole("button", { name: "Edit feature" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Edit feature" }));

  expect(await screen.findByTestId("item-panel")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit feature" })).not.toBeInTheDocument();
});

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

it("board filters survive navigating away and back", async () => {
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
  vi.spyOn(client, "getCapacities").mockResolvedValue([] as never);
  const search = await screen.findByPlaceholderText("Search title…");
  await userEvent.type(search, "widget");
  expect(search).toHaveValue("widget");

  await userEvent.click(await screen.findByRole("link", { name: "Planning" }));
  await userEvent.click(await screen.findByRole("link", { name: "Board" }));

  expect(await screen.findByPlaceholderText("Search title…")).toHaveValue("widget");
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
  await userEvent.click(await screen.findByRole("tab", { name: /pi objectives/i }));
  const btn = await screen.findByRole("button", { name: /new objective/i });
  expect(btn).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /team/i }));
  await userEvent.click(await screen.findByRole("option", { name: "Network" }));
  expect(screen.getByRole("button", { name: /new objective/i })).toBeEnabled();
});
