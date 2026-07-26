import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import * as client from "../../api/client";
import { AuthProvider } from "../../auth/AuthContext";
import AdminView from "./AdminView";

afterEach(() => vi.restoreAllMocks());

function mockAll() {
  vi.spyOn(client, "getTeams").mockResolvedValue([]);
  vi.spyOn(client, "getContainers").mockResolvedValue([]);
  vi.spyOn(client, "getPersonOptions").mockResolvedValue([]);
  vi.spyOn(client, "getCapacities").mockResolvedValue([]);
  vi.spyOn(client, "getPlanningIntervals").mockResolvedValue([]);
  vi.spyOn(client, "getDepartments").mockResolvedValue([]);
  vi.spyOn(client, "getMe").mockResolvedValue({
    id: 1, email: "a@b.ch", display_name: "A", role: "admin", is_active: true,
  } as never);
  vi.spyOn(client, "listUsers").mockResolvedValue([] as never);
  vi.spyOn(client, "getAuditEvents").mockResolvedValue({ items: [], total: 0 } as never);
  vi.spyOn(client, "listSnapshots").mockResolvedValue([]);
}

it("sidebar switches sections (Users is the default)", async () => {
  mockAll();
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/admin/users"]}>
        <Routes>
          <Route path="/admin/:section" element={<AdminView onChanged={() => {}} />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  expect(await screen.findByRole("button", { name: /add person/i })).toBeInTheDocument();
  expect(screen.queryByText(/no snapshots yet/i)).toBeNull();

  await user.click(screen.getByRole("link", { name: "Snapshots" }));
  expect(await screen.findByText(/no snapshots yet/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /add person/i })).toBeNull();
});

it("adds a team from the Teams & Capacity section", async () => {
  mockAll();
  const user = userEvent.setup();
  const create = vi.spyOn(client, "createTeam").mockResolvedValue({ id: 1, name: "Network" });
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/admin/teams"]}>
        <Routes>
          <Route path="/admin/:section" element={<AdminView onChanged={() => {}} />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  await user.type(await screen.findByPlaceholderText(/new team name/i), "Network");
  await user.click(screen.getAllByRole("button", { name: /^add$/i })[0]);
  await waitFor(() => expect(create).toHaveBeenCalledWith("Network"));
});
