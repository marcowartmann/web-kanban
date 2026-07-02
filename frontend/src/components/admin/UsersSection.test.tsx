import { render, screen } from "@testing-library/react";
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
  await userEvent.click(screen.getByRole("button", { name: /add user/i }));
  expect(screen.getByText("Add user")).toBeInTheDocument();
});
