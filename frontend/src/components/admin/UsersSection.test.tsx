import { render, screen, waitFor, within } from "@testing-library/react";
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

it("shows the auth provider (LDAP vs Local) per user", async () => {
  vi.spyOn(client, "listUsers").mockResolvedValue([
    { ...anna, auth_provider: "ldap" },
    { ...ben, auth_provider: "local" },
  ] as never);
  vi.spyOn(client, "getTeams").mockResolvedValue([{ id: 1, name: "Network" }] as never);
  render(<UsersSection currentUserId={1} />);
  expect(await screen.findByText("LDAP")).toBeInTheDocument();
  expect(screen.getByText("Local")).toBeInTheDocument();
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

it("guarded delete: confirms in a dialog and forces when the server reports an assignment conflict", async () => {
  mockData();
  const del = vi
    .spyOn(client, "deleteUser")
    .mockRejectedValueOnce(new client.ConflictError("User 'Ben' is assigned to 2 items"))
    .mockResolvedValueOnce(undefined as never);

  render(<UsersSection currentUserId={1} />);
  await userEvent.click(await screen.findByRole("button", { name: /delete user ben/i }));
  const dialog = await screen.findByRole("alertdialog", { name: "Delete user?" });
  expect(dialog).toHaveTextContent("User 'Ben' is assigned to 2 items");
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete anyway" }));
  await waitFor(() => expect(del).toHaveBeenNthCalledWith(2, 2, true));
  expect(del).toHaveBeenNthCalledWith(1, 2);
});

it("delete blocked by comments shows the detail line and never offers force", async () => {
  mockData();
  vi.spyOn(client, "deleteUser").mockRejectedValue(
    new client.ConflictError("User 'Ben' has 4 comments — deactivate instead"),
  );

  render(<UsersSection currentUserId={1} />);
  await userEvent.click(await screen.findByRole("button", { name: /delete user ben/i }));
  expect(await screen.findByText("User 'Ben' has 4 comments — deactivate instead")).toBeInTheDocument();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
