import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import AdminView from "./AdminView";

afterEach(() => vi.restoreAllMocks());

it("adds a team", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([]);
  vi.spyOn(client, "getTeamMembers").mockResolvedValue([]);
  const create = vi.spyOn(client, "createTeam").mockResolvedValue({ id: 1, name: "Network" });
  render(<AdminView onChanged={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/new team name/i), { target: { value: "Network" } });
  fireEvent.click(screen.getAllByRole("button", { name: /^add$/i })[0]);
  await waitFor(() => expect(create).toHaveBeenCalledWith("Network"));
});

it("adds a member with a team", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([{ id: 2, name: "Network" }]);
  vi.spyOn(client, "getTeamMembers").mockResolvedValue([]);
  const create = vi.spyOn(client, "createTeamMember").mockResolvedValue({
    id: 1, name: "Marco", team_id: 2, team_name: "Network",
  });
  render(<AdminView onChanged={() => {}} />);
  await screen.findByRole("option", { name: "Network" });
  fireEvent.change(screen.getByPlaceholderText(/new member name/i), { target: { value: "Marco" } });
  fireEvent.change(screen.getByLabelText(/^team$/i), { target: { value: "2" } });
  fireEvent.click(screen.getAllByRole("button", { name: /^add$/i })[1]);
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({ name: "Marco", team_id: 2 }),
  );
});
