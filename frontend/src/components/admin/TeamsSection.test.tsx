import { render, screen, within } from "@testing-library/react";
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

it("confirms in a dialog and forces the delete when the server reports usage", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([team] as never);
  const del = vi
    .spyOn(client, "deleteTeam")
    .mockRejectedValueOnce(new client.ConflictError("Team 'Network' is referenced by 3 items"))
    .mockResolvedValueOnce(undefined as never);

  render(<TeamsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /remove team 1/i }));
  const dialog = await screen.findByRole("alertdialog", { name: "Delete team?" });
  expect(dialog).toHaveTextContent("Team 'Network' is referenced by 3 items");
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete anyway" }));
  expect(del).toHaveBeenNthCalledWith(1, 1);
  expect(del).toHaveBeenNthCalledWith(2, 1, true);
});

it("cancelling the dialog leaves the team alone", async () => {
  vi.spyOn(client, "getTeams").mockResolvedValue([team] as never);
  const del = vi
    .spyOn(client, "deleteTeam")
    .mockRejectedValue(new client.ConflictError("Team 'Network' is referenced by 3 items"));

  render(<TeamsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /remove team 1/i }));
  const dialog = await screen.findByRole("alertdialog", { name: "Delete team?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(del).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
