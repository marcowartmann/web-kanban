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
    assignee_id: null,
    leading_team: "Network",
    ...over,
  }) as Item;

beforeEach(() => {
  vi.spyOn(client, "getTeams").mockResolvedValue([
    { id: 1, name: "Network" },
    { id: 2, name: "Platform" },
  ]);
  vi.spyOn(client, "getPersonOptions").mockResolvedValue([
    { id: 1, display_name: "Marco", team_id: 1 },
  ]);
  vi.spyOn(client, "getCapacities").mockResolvedValue([
    { id: 1, user_id: 1, planning_interval: "PI1-Q3", iteration: 2, points: 5 },
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
  await userEvent.click(screen.getByRole("button", { name: /team/i }));
  await userEvent.click(screen.getByRole("option", { name: "Network" }));
  expect(screen.getByText("Net Story")).toBeInTheDocument();
  expect(screen.queryByText("Plat Story")).not.toBeInTheDocument();
});

it("filters to an assignee and scopes capacity to them", async () => {
  const items = [
    story({ id: 1, title: "Marco Story", iteration: 2, story_points: 3, assignee: "Marco", assignee_id: 1 }),
    story({ id: 2, title: "Manuela Story", iteration: 2, story_points: 2, assignee: "Manuela", assignee_id: 2 }),
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

it("filters the stories by department", async () => {
  const items = [
    story({ id: 1, title: "FE Story", iteration: 2, department_name: "FE" }),
    story({ id: 2, title: "BE Story", iteration: 2, department_name: "BE" }),
  ];
  render(
    <PlanningView
      items={items}
      links={[]}
      planningIntervals={["PI1-Q3"]}
      departmentNames={["FE", "BE"]}
      onOpenCard={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(await screen.findByText("BE Story")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /department/i }));
  await userEvent.click(screen.getByRole("option", { name: "FE" }));
  expect(screen.getByText("FE Story")).toBeInTheDocument();
  expect(screen.queryByText("BE Story")).not.toBeInTheDocument();
});

it("Unassigned toggle keeps only iteration stories without an assignee; backlog stays", async () => {
  const items = [
    story({ id: 1, title: "Assigned Story", iteration: 2, assignee: "Marco", assignee_id: 1 }),
    story({ id: 2, title: "Free Story", iteration: 2 }),
    story({ id: 3, title: "Backlog Assigned", iteration: null, assignee: "Marco", assignee_id: 1 }),
  ];
  render(
    <PlanningView items={items} links={[]} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />,
  );
  expect(await screen.findByText("Assigned Story")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /unassigned/i }));

  // Assigned story in an iteration is hidden; unassigned one stays.
  expect(screen.queryByText("Assigned Story")).not.toBeInTheDocument();
  expect(screen.getByText("Free Story")).toBeInTheDocument();
  // The Backlog lane is not filtered by the toggle.
  expect(screen.getByText("Backlog Assigned")).toBeInTheDocument();

  // Toggling off restores the assigned iteration story.
  await userEvent.click(screen.getByRole("button", { name: /unassigned/i }));
  expect(screen.getByText("Assigned Story")).toBeInTheDocument();
});

it("assigns the iteration slot on drop, and null for the backlog", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn().mockResolvedValue(undefined);
  const items = [story({ id: 5, version: 1 })];
  await handlePlanDragEnd({ active: { id: 5 }, over: { id: "3" } } as never, items, reload);
  expect(update).toHaveBeenCalledWith(5, { iteration: 3, version: 1 });
  await handlePlanDragEnd({ active: { id: 5 }, over: { id: "backlog" } } as never, items, reload);
  expect(update).toHaveBeenLastCalledWith(5, { iteration: null, version: 1 });
  expect(reload).toHaveBeenCalledTimes(2);
});

it("Capacity toggle reveals the per-member capacity grid", async () => {
  const items = [story({ id: 1, title: "S", iteration: 2, story_points: 3 })];
  render(
    <PlanningView items={items} links={[]} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />,
  );
  // Marco (a Network member) isn't shown until the grid is toggled on.
  expect(await screen.findByText("S")).toBeInTheDocument();
  expect(screen.queryByText("Marco")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /capacity/i }));
  expect(screen.getByText("Marco")).toBeInTheDocument();
});

it("scopes the capacity grid rows to the selected team's people", async () => {
  vi.spyOn(client, "getPersonOptions").mockResolvedValue([
    { id: 1, display_name: "Marco", team_id: 1 },
    { id: 2, display_name: "Petra", team_id: 2 },
  ]);
  vi.spyOn(client, "getCapacities").mockResolvedValue([
    { id: 1, user_id: 1, planning_interval: "PI1-Q3", iteration: 2, points: 5 },
    { id: 2, user_id: 2, planning_interval: "PI1-Q3", iteration: 2, points: 8 },
  ]);
  const items = [story({ id: 1, title: "S", iteration: 2, story_points: 3 })];
  render(
    <PlanningView items={items} links={[]} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />,
  );
  // All teams: both people's capacity counts toward the Iteration 2 header (5+8)…
  expect(await screen.findByText("3 / 13 SP")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /capacity/i }));
  // …and both have a capacity grid row.
  expect(screen.getByText("Marco")).toBeInTheDocument();
  expect(screen.getByText("Petra")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /team/i }));
  await userEvent.click(screen.getByRole("option", { name: "Network" }));
  // Network selected: Petra (Platform) drops out of the rows and the header capacity.
  expect(screen.getByText("Marco")).toBeInTheDocument();
  expect(screen.queryByText("Petra")).not.toBeInTheDocument();
  expect(screen.getByText("3 / 5 SP")).toBeInTheDocument();
});
