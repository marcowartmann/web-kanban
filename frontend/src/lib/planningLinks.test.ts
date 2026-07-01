import { expect, it } from "vitest";
import type { Item, LinkRow } from "../types";
import { computePlanningLinks } from "./planningLinks";

const story = (
  id: number,
  iteration: number | null,
  pi = "PI1-Q3",
  over: Partial<Item> = {},
): Item =>
  ({
    id,
    kind: "story",
    title: `S${id}`,
    planning_interval: pi,
    iteration,
    parent_id: null,
    ...over,
  }) as unknown as Item;

const blocks = (id: number, source_id: number, target_id: number): LinkRow => ({
  id,
  source_id,
  target_id,
  relation: "blocks",
});

it("flags an error on both ends when the blocker is in a later iteration", () => {
  const items = [story(1, 5), story(2, 2)]; // 1 blocks 2 but sits later
  const info = computePlanningLinks(items, [blocks(10, 1, 2)], "PI1-Q3");
  expect(info.get(1)!.conflicts[0].severity).toBe("error");
  expect(info.get(2)!.conflicts[0].severity).toBe("error");
  expect(info.get(2)!.conflicts[0].message).toContain("#1");
  expect(info.get(2)!.conflicts[0].message).toContain("Iteration 5");
  expect(info.get(1)!.blocks_count).toBe(1);
  expect(info.get(2)!.blocked_by_count).toBe(1);
});

it("warns on both ends when blocker and blocked share an iteration", () => {
  const info = computePlanningLinks([story(1, 3), story(2, 3)], [blocks(10, 1, 2)], "PI1-Q3");
  expect(info.get(1)!.conflicts[0].severity).toBe("warning");
  expect(info.get(2)!.conflicts[0].severity).toBe("warning");
});

it("has no conflict when the blocker is in an earlier iteration", () => {
  const info = computePlanningLinks([story(1, 1), story(2, 4)], [blocks(10, 1, 2)], "PI1-Q3");
  expect(info.get(1)!.conflicts).toHaveLength(0);
  expect(info.get(2)!.conflicts).toHaveLength(0);
});

it("warns on the blocked item when its blocker is unscheduled (backlog) in this PI", () => {
  const info = computePlanningLinks([story(1, null), story(2, 3)], [blocks(10, 1, 2)], "PI1-Q3");
  expect(info.get(2)!.conflicts[0].severity).toBe("warning");
  expect(info.get(2)!.conflicts[0].message).toContain("not scheduled in this PI");
  expect(info.get(1)!.conflicts).toHaveLength(0); // the unscheduled blocker is not itself flagged
});

it("treats a blocker in another PI as unscheduled", () => {
  const items = [story(1, 2, "PI2-Q4"), story(2, 3, "PI1-Q3")];
  const info = computePlanningLinks(items, [blocks(10, 1, 2)], "PI1-Q3");
  expect(info.get(2)!.conflicts[0].severity).toBe("warning");
});

it("counts relates_to on both endpoints without a conflict", () => {
  const links: LinkRow[] = [{ id: 10, source_id: 1, target_id: 2, relation: "relates_to" }];
  const info = computePlanningLinks([story(1, 3), story(2, 3)], links, "PI1-Q3");
  expect(info.get(1)!.related_count).toBe(1);
  expect(info.get(2)!.related_count).toBe(1);
  expect(info.get(1)!.conflicts).toHaveLength(0);
  expect(info.get(2)!.conflicts).toHaveLength(0);
});

it("records conflict partner ids on both ends (for hover highlighting)", () => {
  const info = computePlanningLinks([story(1, 5), story(2, 2)], [blocks(10, 1, 2)], "PI1-Q3");
  expect(info.get(1)!.conflictPartners).toContain(2);
  expect(info.get(2)!.conflictPartners).toContain(1);
  // an unscheduled blocker is still recorded as the blocked item's partner
  const info2 = computePlanningLinks([story(3, null), story(4, 2)], [blocks(11, 3, 4)], "PI1-Q3");
  expect(info2.get(4)!.conflictPartners).toContain(3);
});

it("records all dependency partners (any relation) for highlighting", () => {
  const links: LinkRow[] = [
    { id: 10, source_id: 1, target_id: 2, relation: "blocks" },
    { id: 11, source_id: 1, target_id: 3, relation: "relates_to" },
  ];
  const info = computePlanningLinks([story(1, 1), story(2, 2), story(3, 3)], links, "PI1-Q3");
  expect(info.get(1)!.linkPartners.sort()).toEqual([2, 3]);
  expect(info.get(2)!.linkPartners).toEqual([1]);
  expect(info.get(3)!.linkPartners).toEqual([1]);
  // correctly-ordered blocks -> no conflict, but still a link partner
  expect(info.get(1)!.conflicts).toHaveLength(0);
});

it("has no conflict when the blocked item is not in the viewed PI", () => {
  const items = [story(1, 5, "PI1-Q3"), story(2, 2, "PI2-Q4")];
  const info = computePlanningLinks(items, [blocks(10, 1, 2)], "PI1-Q3");
  expect(info.get(2)?.conflicts ?? []).toHaveLength(0);
});
