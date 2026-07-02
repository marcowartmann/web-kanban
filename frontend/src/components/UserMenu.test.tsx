import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import UserMenu from "./UserMenu";

afterEach(() => vi.restoreAllMocks());

const admin = { id: 1, email: "a@b.ch", display_name: "Anna", role: "admin", is_active: true } as const;

it("shows the name and an admin badge, and logs out", async () => {
  const logout = vi.spyOn(client, "logout").mockResolvedValue(undefined as never);
  const onLoggedOut = vi.fn();
  render(<UserMenu user={admin} onLoggedOut={onLoggedOut} />);
  expect(screen.getByText("Anna")).toBeInTheDocument();
  expect(screen.getByText("admin")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /log out/i }));
  expect(logout).toHaveBeenCalled();
  expect(onLoggedOut).toHaveBeenCalled();
});

it("changes the password through the modal", async () => {
  const change = vi.spyOn(client, "changeMyPassword").mockResolvedValue(undefined as never);
  render(<UserMenu user={{ ...admin, role: "member" }} onLoggedOut={() => {}} />);
  expect(screen.queryByText("admin")).not.toBeInTheDocument(); // members get no badge
  await userEvent.click(screen.getByRole("button", { name: /change password/i }));
  await userEvent.type(screen.getByLabelText(/current password/i), "old12345");
  await userEvent.type(screen.getByLabelText(/new password/i), "new12345");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(change).toHaveBeenCalledWith("old12345", "new12345");
});
