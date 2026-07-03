import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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
  vi.spyOn(client, "getMe").mockResolvedValue({
    id: 1, email: "a@b.ch", display_name: "A", role: "admin", is_active: true,
  } as never);
  vi.spyOn(client, "listUsers").mockResolvedValue([] as never);
  vi.spyOn(client, "getAuditEvents").mockResolvedValue({ items: [], total: 0 } as never);
  vi.spyOn(client, "listSnapshots").mockResolvedValue([]);
}

it("sidebar switches sections (Users is the default)", async () => {
  mockAll();
  render(
    <AuthProvider>
      <AdminView onChanged={() => {}} />
    </AuthProvider>,
  );
  expect(await screen.findByRole("button", { name: /add person/i })).toBeInTheDocument();
  expect(screen.queryByText(/no snapshots yet/i)).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Snapshots" }));
  expect(await screen.findByText(/no snapshots yet/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /add person/i })).toBeNull();
});

it("adds a team from the Teams & Capacity section", async () => {
  mockAll();
  const create = vi.spyOn(client, "createTeam").mockResolvedValue({ id: 1, name: "Network" });
  render(
    <AuthProvider>
      <AdminView onChanged={() => {}} />
    </AuthProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Teams & Capacity" }));
  fireEvent.change(await screen.findByPlaceholderText(/new team name/i), { target: { value: "Network" } });
  fireEvent.click(screen.getAllByRole("button", { name: /^add$/i })[0]);
  await waitFor(() => expect(create).toHaveBeenCalledWith("Network"));
});
