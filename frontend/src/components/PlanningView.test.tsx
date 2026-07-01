import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { Item } from "../types";
import PlanningView, { handlePlanDragEnd } from "./PlanningView";

afterEach(() => vi.restoreAllMocks());

const story = (over: Partial<Item>): Item =>
  ({
    id: 1,
    kind: "story",
    title: "S",
    planning_interval: "PI1-Q3",
    iteration: null,
    story_points: null,
    parent_id: null,
    assignee: null,
    leading_team: "Network",
    ...over,
  }) as Item;

beforeEach(() => {
  vi.spyOn(client, "getTeams").mockResolvedValue([
    { id: 1, name: "Network" },
    { id: 2, name: "Platform" },
  ]);
  vi.spyOn(client, "getTeamMembers").mockResolvedValue([
    { id: 1, name: "Marco", team_id: 1, team_name: "Network" },
  ]);
  vi.spyOn(client, "getCapacities").mockResolvedValue([
    { id: 1, member_id: 1, planning_interval: "PI1-Q3", iteration: 2, points: 5 },
  ]);
});

it("shows Backlog + Iteration 1–5 + IP and a slot's Load / Cap", async () => {
  const items = [
    story({ id: 1, title: "Backlog Story", iteration: null }),
    story({ id: 2, title: "Slotted Story", iteration: 2, story_points: 3 }),
  ];
  render(
    <PlanningView items={items} links={[]} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />,
  );
  expect(screen.getByText("Backlog")).toBeInTheDocument();
  expect(screen.getByText("IP")).toBeInTheDocument();
  expect(screen.getByText("Slotted Story")).toBeInTheDocument();
  // Load 3 of the member's Cap 5 in Iteration 2.
  expect(await screen.findByText("3 / 5 SP")).toBeInTheDocument();
});

it("scopes the stories to the selected team", async () => {
  const items = [
    story({ id: 1, title: "Net Story", iteration: 2, leading_team: "Network" }),
    story({ id: 2, title: "Plat Story", iteration: 2, leading_team: "Platform" }),
  ];
  render(
    <PlanningView items={items} links={[]} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />,
  );
  expect(await screen.findByText("Plat Story")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Network" }));
  expect(screen.getByText("Net Story")).toBeInTheDocument();
  expect(screen.queryByText("Plat Story")).not.toBeInTheDocument();
});

it("filters to an assignee and scopes capacity to them", async () => {
  const items = [
    story({ id: 1, title: "Marco Story", iteration: 2, story_points: 3, assignee: "Marco" }),
    story({ id: 2, title: "Manuela Story", iteration: 2, story_points: 2, assignee: "Manuela" }),
  ];
  render(
    <PlanningView items={items} links={[]} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />,
  );
  // Everyone: load 3+2 vs the one member's Cap 5.
  expect(await screen.findByText("Manuela Story")).toBeInTheDocument();
  expect(screen.getByText("5 / 5 SP")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /assignee/i }));
  await userEvent.click(screen.getByRole("option", { name: "Marco" }));

  expect(screen.getByText("Marco Story")).toBeInTheDocument();
  expect(screen.queryByText("Manuela Story")).not.toBeInTheDocument();
  // Now just Marco's load 3 vs his Cap 5.
  expect(screen.getByText("3 / 5 SP")).toBeInTheDocument();
});

it("assigns the iteration slot on drop, and null for the backlog", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn().mockResolvedValue(undefined);
  await handlePlanDragEnd({ active: { id: 5 }, over: { id: "3" } } as never, reload);
  expect(update).toHaveBeenCalledWith(5, { iteration: 3 });
  await handlePlanDragEnd({ active: { id: 5 }, over: { id: "backlog" } } as never, reload);
  expect(update).toHaveBeenLastCalledWith(5, { iteration: null });
  expect(reload).toHaveBeenCalledTimes(2);
});
