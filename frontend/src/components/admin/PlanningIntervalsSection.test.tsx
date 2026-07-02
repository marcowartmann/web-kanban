import { render, screen } from "@testing-library/react";
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
