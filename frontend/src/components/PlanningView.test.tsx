import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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
    ...over,
  }) as Item;

it("renders Backlog + Iteration 1–5 + IP and places a story in its slot", () => {
  const items = [
    story({ id: 1, title: "Backlog Story", iteration: null }),
    story({ id: 2, title: "Slotted Story", iteration: 2 }),
  ];
  render(
    <PlanningView
      items={items}
      planningIntervals={["PI1-Q3"]}
      onOpenCard={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(screen.getByText("Backlog")).toBeInTheDocument();
  expect(screen.getByText("Iteration 1")).toBeInTheDocument();
  expect(screen.getByText("Iteration 5")).toBeInTheDocument();
  expect(screen.getByText("IP")).toBeInTheDocument();
  expect(screen.getByText("Backlog Story")).toBeInTheDocument();
  expect(screen.getByText("Slotted Story")).toBeInTheDocument();
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
