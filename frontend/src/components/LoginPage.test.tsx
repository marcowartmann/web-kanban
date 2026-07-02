import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import LoginPage from "./LoginPage";

afterEach(() => vi.restoreAllMocks());

const user = { id: 1, email: "a@b.ch", display_name: "A", role: "admin", is_active: true } as const;

it("submits credentials and reports the user", async () => {
  const login = vi.spyOn(client, "login").mockResolvedValue(user as never);
  const onLoggedIn = vi.fn();
  render(<LoginPage onLoggedIn={onLoggedIn} />);
  await userEvent.type(screen.getByLabelText(/email/i), "a@b.ch");
  await userEvent.type(screen.getByLabelText(/password/i), "pw123456");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(login).toHaveBeenCalledWith("a@b.ch", "pw123456");
  expect(onLoggedIn).toHaveBeenCalledWith(user);
});

it("shows an error on rejected login", async () => {
  vi.spyOn(client, "login").mockRejectedValue(new Error("401"));
  render(<LoginPage onLoggedIn={() => {}} />);
  await userEvent.type(screen.getByLabelText(/email/i), "a@b.ch");
  await userEvent.type(screen.getByLabelText(/password/i), "wrong123");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
});
