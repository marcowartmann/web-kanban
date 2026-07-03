import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import LoginPage from "./LoginPage";

afterEach(() => vi.restoreAllMocks());

const user = { id: 1, email: "a@b.ch", display_name: "A", role: "admin", is_active: true } as const;

function stubConfig(ldapEnabled: boolean) {
  vi.spyOn(client, "getAuthConfig").mockResolvedValue({ ldap_enabled: ldapEnabled });
}

it("defaults to LDAP and submits username/password/method", async () => {
  stubConfig(true);
  const login = vi.spyOn(client, "login").mockResolvedValue(user as never);
  const onLoggedIn = vi.fn();
  render(<LoginPage onLoggedIn={onLoggedIn} />);
  // Wait for the config probe to render the toggle.
  await screen.findByRole("button", { name: /^ldap$/i });
  await userEvent.type(screen.getByLabelText(/username/i), "jdoe");
  await userEvent.type(screen.getByLabelText(/password/i), "pw123456");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(login).toHaveBeenCalledWith("jdoe", "pw123456", "ldap");
  expect(onLoggedIn).toHaveBeenCalledWith(user);
});

it("submits method=local after selecting the Local toggle", async () => {
  stubConfig(true);
  const login = vi.spyOn(client, "login").mockResolvedValue(user as never);
  render(<LoginPage onLoggedIn={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: /^local$/i }));
  await userEvent.type(screen.getByLabelText(/username/i), "admin");
  await userEvent.type(screen.getByLabelText(/password/i), "pw123456");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(login).toHaveBeenCalledWith("admin", "pw123456", "local");
});

it("hides the toggle and uses local when ldap is disabled", async () => {
  stubConfig(false);
  const login = vi.spyOn(client, "login").mockResolvedValue(user as never);
  render(<LoginPage onLoggedIn={vi.fn()} />);
  await userEvent.type(await screen.findByLabelText(/username/i), "admin");
  await userEvent.type(screen.getByLabelText(/password/i), "pw123456");
  expect(screen.queryByRole("button", { name: /^ldap$/i })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(login).toHaveBeenCalledWith("admin", "pw123456", "local");
});

it("shows an error on rejected login", async () => {
  stubConfig(false);
  vi.spyOn(client, "login").mockRejectedValue(new Error("401"));
  render(<LoginPage onLoggedIn={() => {}} />);
  await userEvent.type(await screen.findByLabelText(/username/i), "admin");
  await userEvent.type(screen.getByLabelText(/password/i), "wrong123");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(await screen.findByText(/invalid username or password/i)).toBeInTheDocument();
});
