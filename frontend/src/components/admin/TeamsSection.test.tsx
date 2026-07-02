import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import TeamsSection from "./TeamsSection";

afterEach(() => vi.restoreAllMocks());

const team = { id: 1, name: "Network" };

it("renames a team inline", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([team] as never);
  const rename = vi.spyOn(client, "renameTeam").mockResolvedValue({ id: 1, name: "Net" } as never);

  render(<TeamsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /rename team 1/i }));
  const input = screen.getByRole("textbox", { name: /new name for team 1/i });
  await userEvent.clear(input);
  await userEvent.type(input, "Net");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(rename).toHaveBeenCalledWith(1, "Net");
});

it("shows the error line when a rename conflicts", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([team] as never);
  vi.spyOn(client, "renameTeam").mockRejectedValue(new client.ConflictError("Team already exists"));

  render(<TeamsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /rename team 1/i }));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(await screen.findByText("Team already exists")).toBeInTheDocument();
});

it("confirms and forces the delete when the server reports usage", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([team] as never);
  const del = vi
    .spyOn(client, "deleteTeam")
    .mockRejectedValueOnce(new client.ConflictError("Team 'Network' is referenced by 3 items"))
    .mockResolvedValueOnce(undefined as never);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

  render(<TeamsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /remove team 1/i }));
  expect(confirm).toHaveBeenCalledWith("Team 'Network' is referenced by 3 items Delete anyway?");
  expect(del).toHaveBeenNthCalledWith(1, 1);
  expect(del).toHaveBeenNthCalledWith(2, 1, true);
});

it("declining the confirm leaves the team alone", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([team] as never);
  const del = vi
    .spyOn(client, "deleteTeam")
    .mockRejectedValue(new client.ConflictError("Team 'Network' is referenced by 3 items"));
  vi.spyOn(window, "confirm").mockReturnValue(false);

  render(<TeamsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /remove team 1/i }));
  expect(del).toHaveBeenCalledTimes(1);
});
