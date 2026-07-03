import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import DepartmentsSection from "./DepartmentsSection";

afterEach(() => vi.restoreAllMocks());

function mockData() {
  vi.spyOn(client, "getTeams").mockResolvedValue([{ id: 1, name: "Net" }] as never);
  vi.spyOn(client, "getPersonOptions").mockResolvedValue(
    [{ id: 7, display_name: "Ann", team_id: 1 }] as never,
  );
  vi.spyOn(client, "getDepartments").mockResolvedValue(
    [{ id: 3, name: "Frontend", team_id: 1, team_name: "Net", member_ids: [] }] as never,
  );
}

it("lists departments grouped by team", async () => {
  mockData();
  render(<DepartmentsSection onChanged={vi.fn()} />);
  expect(await screen.findByText("Frontend")).toBeInTheDocument();
  expect(screen.getByText("Net")).toBeInTheDocument();
});

it("creates a department under a team", async () => {
  mockData();
  const create = vi.spyOn(client, "createDepartment").mockResolvedValue(
    { id: 4, name: "Backend", team_id: 1, team_name: "Net", member_ids: [] } as never,
  );
  render(<DepartmentsSection onChanged={vi.fn()} />);
  await screen.findByText("Frontend");
  await userEvent.type(screen.getByLabelText(/new department for Net/i), "Backend");
  await userEvent.click(screen.getByRole("button", { name: /add department to Net/i }));
  await waitFor(() => expect(create).toHaveBeenCalledWith("Backend", 1));
});

it("toggling a member calls setDepartmentMembers", async () => {
  mockData();
  const setMembers = vi.spyOn(client, "setDepartmentMembers").mockResolvedValue(
    { id: 3, name: "Frontend", team_id: 1, team_name: "Net", member_ids: [7] } as never,
  );
  render(<DepartmentsSection onChanged={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: /members of Frontend/i }));
  const ann = within(screen.getByTestId("members-3")).getByLabelText("Ann");
  await userEvent.click(ann);
  await waitFor(() => expect(setMembers).toHaveBeenCalledWith(3, [7]));
});
