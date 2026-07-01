import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { Item } from "../types";
import TimelineView, { handleTimelineDragEnd } from "./TimelineView";

afterEach(() => vi.restoreAllMocks());

const feature = (id: number, over: Partial<Item> = {}): Item =>
  ({ id, kind: "feature", type: "Feature", title: `F${id}`, position: id, planning_interval: "PI1-Q3", parent_id: null, ...over }) as unknown as Item;
const story = (id: number, parent_id: number, iteration: number | null): Item =>
  ({ id, kind: "story", title: `S${id}`, parent_id, iteration, planning_interval: "PI1-Q3" }) as unknown as Item;

it("renders feature lanes with stories in their iteration cells", () => {
  const items = [feature(1), story(11, 1, 1), story(12, 1, null)];
  render(<TimelineView items={items} links={[]} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />);
  expect(screen.getByText("F1")).toBeInTheDocument();
  expect(screen.getByText("S11")).toBeInTheDocument();
  expect(screen.getByText("S12")).toBeInTheDocument(); // backlog visible by default (Show all)
});

it("the Only planned toggle hides the backlog story", async () => {
  const items = [feature(1), story(11, 1, 1), story(12, 1, null)];
  render(<TimelineView items={items} links={[]} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /only planned/i }));
  expect(screen.getByText("S11")).toBeInTheDocument();
  expect(screen.queryByText("S12")).not.toBeInTheDocument();
});

it("handleTimelineDragEnd updates iteration from the drop target slot", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn().mockResolvedValue(undefined);
  await handleTimelineDragEnd({ active: { id: 11 }, over: { id: "1::3" } } as never, reload);
  expect(update).toHaveBeenCalledWith(11, { iteration: 3 });
  await handleTimelineDragEnd({ active: { id: 11 }, over: { id: "1::backlog" } } as never, reload);
  expect(update).toHaveBeenLastCalledWith(11, { iteration: null });
});

it("dependencies mode narrows to the selected item's transitive component", async () => {
  const items = [feature(1), story(11, 1, 1), story(12, 1, 2), story(13, 1, 3)];
  const links = [
    { id: 1, source_id: 11, target_id: 12, relation: "blocks" as const },
    // 13 is unrelated
  ];
  render(<TimelineView items={items} links={links} planningIntervals={["PI1-Q3"]} onOpenCard={() => {}} onChanged={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Dependencies" }));
  // empty selection -> all PI stories shown
  expect(screen.getByText("S13")).toBeInTheDocument();
  // select S11 -> component is {11,12}; S13 drops out
  await userEvent.click(screen.getByText("S11"));
  expect(screen.getByText("S11")).toBeInTheDocument();
  expect(screen.getByText("S12")).toBeInTheDocument();
  expect(screen.queryByText("S13")).not.toBeInTheDocument();
  // clear resets
  await userEvent.click(screen.getByRole("button", { name: /clear/i }));
  expect(screen.getByText("S13")).toBeInTheDocument();
});
