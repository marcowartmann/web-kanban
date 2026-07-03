import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import PlanningIntervalsSection from "./PlanningIntervalsSection";

afterEach(() => vi.restoreAllMocks());

it("lists, adds, and removes planning intervals", async () => {
  vi.spyOn(client, "getPlanningIntervals").mockResolvedValue([{ id: 1, name: "PI1-Q3", position: 0 }] as never);
  const create = vi.spyOn(client, "createPlanningInterval").mockResolvedValue({ id: 2, name: "PI2-Q4", position: 1 } as never);
  const del = vi.spyOn(client, "deletePlanningInterval").mockResolvedValue(undefined as never);

  render(<PlanningIntervalsSection onChanged={() => {}} />);
  expect(await screen.findByText("PI1-Q3")).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/new planning interval/i), "PI2-Q4");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(create).toHaveBeenCalledWith("PI2-Q4");

  await userEvent.click(screen.getByRole("button", { name: /remove planning interval 1/i }));
  expect(del).toHaveBeenCalledWith(1);
});

it("confirms in a dialog and forces the delete when the server reports usage", async () => {
  vi.spyOn(client, "getPlanningIntervals").mockResolvedValue([{ id: 1, name: "PI1-Q3", position: 0 }] as never);
  const del = vi
    .spyOn(client, "deletePlanningInterval")
    .mockRejectedValueOnce(new client.ConflictError("Planning interval 'PI1-Q3' is used by 4 items"))
    .mockResolvedValueOnce(undefined as never);

  render(<PlanningIntervalsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /remove planning interval 1/i }));
  const dialog = await screen.findByRole("alertdialog", { name: "Delete planning interval?" });
  expect(dialog).toHaveTextContent("Planning interval 'PI1-Q3' is used by 4 items");
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete anyway" }));
  expect(del).toHaveBeenNthCalledWith(1, 1);
  expect(del).toHaveBeenNthCalledWith(2, 1, true);
});

it("renames a planning interval inline", async () => {
  vi.spyOn(client, "getPlanningIntervals").mockResolvedValue([{ id: 1, name: "PI1", position: 0 }] as never);
  const rename = vi.spyOn(client, "renamePlanningInterval").mockResolvedValue({ id: 1, name: "PI1-Q3", position: 0 } as never);

  render(<PlanningIntervalsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /rename planning interval 1/i }));
  const input = screen.getByRole("textbox", { name: /new name for planning interval 1/i });
  await userEvent.clear(input);
  await userEvent.type(input, "PI1-Q3");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(rename).toHaveBeenCalledWith(1, "PI1-Q3");
});
