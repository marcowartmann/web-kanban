import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "./api/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";

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
  vi.spyOn(client, "getContainers").mockResolvedValue([] as never);
  vi.spyOn(client, "listUsers").mockResolvedValue([] as never);
}

it("admins reach Import CSV inside the Admin section", async () => {
  mockAppData("admin");
  render(
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>,
  );
  // Import is no longer in the board header; it lives in Admin.
  expect(screen.queryByText(/import csv/i)).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Admin" }));
  expect(await screen.findByRole("button", { name: /import csv/i })).toBeInTheDocument();
});

it("members see neither the Admin tab nor Import", async () => {
  mockAppData("member");
  render(
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>,
  );
  expect(await screen.findByText("U")).toBeInTheDocument(); // user menu rendered
  expect(screen.queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();
  expect(screen.queryByText(/import csv/i)).not.toBeInTheDocument();
});
