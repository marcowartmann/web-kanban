import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import UsersSection from "./UsersSection";

afterEach(() => vi.restoreAllMocks());

const anna = {
  id: 1, email: "a@b.ch", display_name: "Anna", role: "admin",
  is_active: true, team_id: 1, team_name: "Network",
} as const;
const ben = {
  id: 2, email: "b@b.ch", display_name: "Ben", role: "member",
  is_active: false, team_id: null, team_name: null,
} as const;

function mockData() {
  vi.spyOn(client, "listUsers").mockResolvedValue([anna, ben] as never);
  vi.spyOn(client, "getTeams").mockResolvedValue([{ id: 1, name: "Network" }] as never);
}

it("renders the table with email, team, and status", async () => {
  mockData();
  render(<UsersSection currentUserId={1} />);
  expect(await screen.findByText("Anna")).toBeInTheDocument();
  expect(screen.getByText("a@b.ch")).toBeInTheDocument();
  expect(screen.getByText("Network")).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument(); // Ben has no team
  expect(screen.getByText("inactive")).toBeInTheDocument();
});

it("opens the edit modal prefilled, and the add modal", async () => {
  mockData();
  render(<UsersSection currentUserId={1} />);
  await screen.findByText("Anna");
  await userEvent.click(screen.getByRole("button", { name: /edit user ben/i }));
  expect(screen.getByDisplayValue("b@b.ch")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
  await userEvent.click(screen.getByRole("button", { name: /add person/i }));
  expect(screen.getByText("Add user")).toBeInTheDocument();
});

it("guarded delete: confirms and forces when the server reports an assignment conflict", async () => {
  mockData();
  const del = vi
    .spyOn(client, "deleteUser")
    .mockRejectedValueOnce(new client.ConflictError("User 'Ben' is assigned to 2 items"))
    .mockResolvedValueOnce(undefined as never);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

  render(<UsersSection currentUserId={1} />);
  await userEvent.click(await screen.findByRole("button", { name: /delete user ben/i }));
  await waitFor(() => expect(del).toHaveBeenNthCalledWith(2, 2, true));
  expect(confirm).toHaveBeenCalledWith("User 'Ben' is assigned to 2 items Delete anyway?");
  expect(del).toHaveBeenNthCalledWith(1, 2);
});

it("delete blocked by comments shows the detail line and never confirms", async () => {
  mockData();
  vi.spyOn(client, "deleteUser").mockRejectedValue(
    new client.ConflictError("User 'Ben' has 4 comments — deactivate instead"),
  );
  const confirm = vi.spyOn(window, "confirm");

  render(<UsersSection currentUserId={1} />);
  await userEvent.click(await screen.findByRole("button", { name: /delete user ben/i }));
  expect(await screen.findByText("User 'Ben' has 4 comments — deactivate instead")).toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
});
