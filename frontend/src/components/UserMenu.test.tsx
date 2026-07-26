import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import UserMenu from "./UserMenu";

afterEach(() => vi.restoreAllMocks());

const admin = { id: 1, email: "a@b.ch", display_name: "Anna", role: "admin", is_active: true } as const;

it("shows the name and an admin badge, and logs out from the menu", async () => {
  const logout = vi.spyOn(client, "logout").mockResolvedValue(undefined as never);
  const onLoggedOut = vi.fn();
  render(<UserMenu user={admin} onLoggedOut={onLoggedOut} />);
  expect(screen.getByText("Anna")).toBeInTheDocument();
  expect(screen.getByText("admin")).toBeInTheDocument();
  // Actions live inside the dropdown, hidden until the trigger is clicked.
  expect(screen.queryByRole("menuitem", { name: /log out/i })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: /anna/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /log out/i }));
  expect(logout).toHaveBeenCalled();
  expect(onLoggedOut).toHaveBeenCalled();
});

it("changes the password through the menu → modal", async () => {
  const change = vi.spyOn(client, "changeMyPassword").mockResolvedValue(undefined as never);
  render(<UserMenu user={{ ...admin, role: "member" }} onLoggedOut={() => {}} />);
  expect(screen.queryByText("admin")).not.toBeInTheDocument(); // members get no badge
  await userEvent.click(screen.getByRole("button", { name: /anna/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /change password/i }));
  await userEvent.type(screen.getByLabelText(/current password/i), "old12345");
  await userEvent.type(screen.getByLabelText(/new password/i), "new12345");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(change).toHaveBeenCalledWith("old12345", "new12345");
});

it("ArrowDown from the trigger and ArrowUp/ArrowDown wrap between the two menuitems", async () => {
  render(<UserMenu user={admin} onLoggedOut={() => {}} />);
  const trigger = screen.getByRole("button", { name: /anna/i });
  await userEvent.click(trigger);
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: /change password/i })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: /log out/i })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}"); // wraps back to the first item
  expect(screen.getByRole("menuitem", { name: /change password/i })).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}"); // wraps the other way
  expect(screen.getByRole("menuitem", { name: /log out/i })).toHaveFocus();
});

it("Escape closes the menu and returns focus to the trigger", async () => {
  render(<UserMenu user={admin} onLoggedOut={() => {}} />);
  const trigger = screen.getByRole("button", { name: /anna/i });
  await userEvent.click(trigger);
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: /change password/i })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
