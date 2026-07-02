import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { AuthProvider, useAuth } from "./AuthContext";

afterEach(() => vi.restoreAllMocks());

const admin = { id: 1, email: "a@b.ch", display_name: "Anna", role: "admin", is_active: true } as const;

function Probe() {
  const { user } = useAuth();
  return <div>hello {user.display_name}</div>;
}

it("renders children once the probe succeeds", async () => {
  vi.spyOn(client, "getMe").mockResolvedValue(admin as never);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  expect(await screen.findByText("hello Anna")).toBeInTheDocument();
});

it("renders the login page when the probe 401s", async () => {
  vi.spyOn(client, "getMe").mockRejectedValue(new Error("401"));
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
  expect(screen.queryByText(/hello/)).not.toBeInTheDocument();
});
