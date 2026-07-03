import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import * as client from "../api/client";
import { ConflictError } from "../api/client";
import BoardView, { handleCardDragEnd } from "./BoardView";
import type { Board, Item } from "../types";

afterEach(() => vi.restoreAllMocks());

const board: Board = {
  id: 1, name: "Features & Stories", kinds: ["feature", "story"], position: 0,
  lanes: [
    { id: 10, name: "Funnel", position: 0 },
    { id: 11, name: "Analyzing", position: 1 },
  ],
};

const items: Item[] = [
  { id: 1, kind: "feature", type: "Feature", parent_id: null, position: 0, version: 1, title: "Feat A",
    status: "Analyzing", description: null, kategorie: null, art: null, sdi_prio: null,
    tshirt_size: null, wsjf_score: null, story_points: null, planning_interval: null, iteration: null,
    leading_team: null, supporting_team: null, container_id: null, externer_partner: null, assignee: null,
    assignee_id: null,
    akzeptanzkriterien: null, bo_stakeholder: null,
    business_value: null, time_criticality: null, risk_reduction: null,
    cost_of_delay: null, job_size: null, definition_of_done: null },
  { id: 2, kind: "risk", type: "Risk", parent_id: null, position: 1, version: 1, title: "Risk B",
    status: "Analyzing", description: null, kategorie: null, art: null, sdi_prio: null,
    tshirt_size: null, wsjf_score: null, story_points: null, planning_interval: null, iteration: null,
    leading_team: null, supporting_team: null, container_id: null, externer_partner: null, assignee: null,
    assignee_id: null,
    akzeptanzkriterien: null, bo_stakeholder: null,
    business_value: null, time_criticality: null, risk_reduction: null,
    cost_of_delay: null, job_size: null, definition_of_done: null },
];

it("renders the board's lanes + Unscheduled and only the board's kinds", () => {
  render(<BoardView board={board} items={items} links={[]} filters={{}} onOpenCard={() => {}} onOpenStories={() => {}} onChanged={() => {}} />);
  expect(screen.getByText("Funnel")).toBeInTheDocument();
  expect(screen.getByText("Analyzing")).toBeInTheDocument();
  expect(screen.getByText("Unscheduled")).toBeInTheDocument();
  expect(screen.getByText("Feat A")).toBeInTheDocument();
  // the risk is not one of this board's kinds, so it must not appear
  expect(screen.queryByText("Risk B")).toBeNull();
});

it("container filter matches cards by their container's name", () => {
  const containers = [
    { id: 7, name: "Operations", planning_interval: "PI1-Q3", team_id: 1 },
    { id: 8, name: "Operations", planning_interval: "PI2-Q4", team_id: 2 },
  ];
  const boxed = [
    { ...items[0], id: 1, title: "Feat A", container_id: 7 },
    { ...items[0], id: 3, title: "Feat C", container_id: null },
  ];
  render(
    <BoardView
      board={board}
      items={boxed}
      links={[]}
      filters={{ container: "Operations" }}
      containers={containers}
      onOpenCard={() => {}}
      onOpenStories={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(screen.getByText("Feat A")).toBeInTheDocument();
  expect(screen.queryByText("Feat C")).toBeNull();
});

it("drag handler sets status to the lane (and '' for Unscheduled) then reloads", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn().mockResolvedValue(undefined);
  await handleCardDragEnd({ active: { id: 1 }, over: { id: "Funnel" } } as never, items, reload);
  expect(update).toHaveBeenCalledWith(1, { status: "Funnel", version: 1 });
  await handleCardDragEnd({ active: { id: 1 }, over: { id: "Unscheduled" } } as never, items, reload);
  expect(update).toHaveBeenCalledWith(1, { status: "", version: 1 });
  expect(reload).toHaveBeenCalledTimes(2);
});

it("drag conflict still reloads and does not throw", async () => {
  vi.spyOn(client, "updateItem").mockRejectedValue(new ConflictError("Item was modified by someone else — reload and retry"));
  const reload = vi.fn();
  const items = [{ id: 5, version: 2 } as unknown as Item];
  await handleCardDragEnd(
    { active: { id: 5 }, over: { id: "Ready" } } as unknown as DragEndEvent,
    items,
    reload,
  );
  expect(reload).toHaveBeenCalled();
});
