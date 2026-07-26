import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { AuthProvider } from "../auth/AuthContext";
import { ThemeProvider } from "../theme/ThemeContext";
import Sidebar from "./Sidebar";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

function renderSidebar(role: "admin" | "member" = "admin") {
  vi.spyOn(client, "getMe").mockResolvedValue(
    { id: 1, email: "u@x.ch", display_name: "U", role, team_id: 1, is_active: true } as never,
  );
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={["/board"]}>
          <Sidebar onLoggedOut={() => {}} />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

it("renders both groups with all nine views for admins", async () => {
  renderSidebar("admin");
  expect(await screen.findByText("Work")).toBeInTheDocument();
  expect(screen.getByText("Catalog")).toBeInTheDocument();
  for (const name of ["Board", "Planning", "Timeline", "Ranking", "Products", "Lifecycle", "Contracts", "Roadmap", "Admin"]) {
    expect(screen.getByRole("link", { name })).toBeInTheDocument();
  }
  expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
});

it("hides the Admin entry for members", async () => {
  renderSidebar("member");
  expect(await screen.findByRole("link", { name: "Board" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});

it("collapse hides labels, keeps accessible names, and persists", async () => {
  renderSidebar("admin");
  await userEvent.click(await screen.findByRole("button", { name: "Collapse sidebar" }));
  expect(localStorage.getItem("jamra.sidebarCollapsed")).toBe("1");
  expect(screen.queryByText("Work")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Planning" })).toBeInTheDocument(); // via aria-label
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
});
