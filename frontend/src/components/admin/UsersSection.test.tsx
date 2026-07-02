import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import UsersSection from "./UsersSection";

afterEach(() => vi.restoreAllMocks());

const anna = { id: 1, email: "a@b.ch", display_name: "Anna", role: "admin", is_active: true } as const;
const ben = { id: 2, email: "b@b.ch", display_name: "Ben", role: "member", is_active: true } as const;

it("lists, creates, edits role, and deactivates users", async () => {
  vi.spyOn(client, "listUsers").mockResolvedValue([anna, ben] as never);
  const create = vi.spyOn(client, "createUser").mockResolvedValue({ ...ben, id: 3 } as never);
  const update = vi.spyOn(client, "updateUser").mockResolvedValue({ ...ben, role: "admin" } as never);

  render(<UsersSection currentUserId={1} />);
  expect(await screen.findByText("Anna")).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/name/i), "Cleo");
  await userEvent.type(screen.getByPlaceholderText(/email/i), "c@b.ch");
  await userEvent.type(screen.getByPlaceholderText(/password/i), "pw123456");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(create).toHaveBeenCalledWith({
    email: "c@b.ch",
    display_name: "Cleo",
    password: "pw123456",
    role: "member",
  });

  await userEvent.selectOptions(screen.getByLabelText("role of Ben"), "admin");
  expect(update).toHaveBeenCalledWith(2, { role: "admin" });

  await userEvent.click(screen.getByRole("button", { name: /deactivate ben/i }));
  expect(update).toHaveBeenCalledWith(2, { is_active: false });
});

it("hides the deactivate control for the current user", async () => {
  vi.spyOn(client, "listUsers").mockResolvedValue([anna] as never);
  render(<UsersSection currentUserId={1} />);
  expect(await screen.findByText("Anna")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /deactivate anna/i })).not.toBeInTheDocument();
});
