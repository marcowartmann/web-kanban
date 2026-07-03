import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "./api/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";

afterEach(() => vi.restoreAllMocks());

function mockAppData(role: "admin" | "member") {
  vi.spyOn(client, "getMe").mockResolvedValue(
    { id: 1, email: "u@x.ch", display_name: "U", role, is_active: true } as never,
  );
  vi.spyOn(client, "getBoards").mockResolvedValue([] as never);
  vi.spyOn(client, "listItems").mockResolvedValue([] as never);
  vi.spyOn(client, "listLinks").mockResolvedValue([] as never);
  vi.spyOn(client, "getPlanningIntervals").mockResolvedValue([] as never);
  vi.spyOn(client, "getPersonOptions").mockResolvedValue([] as never);
  vi.spyOn(client, "getTeams").mockResolvedValue([] as never);
}

it("admins see the Admin tab and Import", async () => {
  mockAppData("admin");
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
  expect(await screen.findByRole("button", { name: "Admin" })).toBeInTheDocument();
  expect(screen.getByText(/import csv/i)).toBeInTheDocument();
});

it("members see neither the Admin tab nor Import", async () => {
  mockAppData("member");
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
  expect(await screen.findByText("U")).toBeInTheDocument(); // user menu rendered
  expect(screen.queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();
  expect(screen.queryByText(/import csv/i)).not.toBeInTheDocument();
});
