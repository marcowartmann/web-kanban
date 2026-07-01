import { expect, it } from "vitest";
import type { Capacity, Item } from "../types";
import {
  capacityBySlot,
  groupStoriesByIteration,
  iterationLabel,
  slotPoints,
} from "./iterations";

const cap = (over: Partial<Capacity>): Capacity =>
  ({ id: 1, member_id: 1, planning_interval: "PI1-Q3", iteration: 1, points: 0, ...over }) as Capacity;

const story = (over: Partial<Item>): Item =>
  ({
    id: 1,
    kind: "story",
    planning_interval: "PI1-Q3",
    iteration: null,
    story_points: null,
    ...over,
  }) as Item;

it("labels slot 6 as IP and the rest as Iteration N", () => {
  expect(iterationLabel(1)).toBe("Iteration 1");
  expect(iterationLabel(5)).toBe("Iteration 5");
  expect(iterationLabel(6)).toBe("IP");
});

it("buckets stories of a PI into backlog and slots, ignoring others", () => {
  const items = [
    story({ id: 1, iteration: null }),
    story({ id: 2, iteration: 2 }),
    story({ id: 3, iteration: 6 }),
    story({ id: 4, iteration: 2, planning_interval: "PI2-Q4" }), // other PI
    story({ id: 5, kind: "feature", iteration: 2 }), // not a story
  ];
  const g = groupStoriesByIteration(items, "PI1-Q3");
  expect(g.backlog.map((s) => s.id)).toEqual([1]);
  expect(g.slots[2].map((s) => s.id)).toEqual([2]);
  expect(g.slots[6].map((s) => s.id)).toEqual([3]);
  expect(g.slots[1]).toEqual([]);
});

it("sums story points and trims float noise", () => {
  expect(slotPoints([story({ story_points: 2.4 }), story({ story_points: 0.5 })])).toBe(2.9);
  expect(slotPoints([story({ story_points: null })])).toBe(0);
});

it("sums capacity per slot for a PI, honoring the member filter", () => {
  const caps = [
    cap({ member_id: 1, iteration: 1, points: 8 }),
    cap({ member_id: 2, iteration: 1, points: 5 }),
    cap({ member_id: 1, iteration: 6, points: 2 }),
    cap({ member_id: 1, iteration: 1, points: 3, planning_interval: "PI2-Q4" }), // other PI
  ];
  const all = capacityBySlot(caps, "PI1-Q3", null);
  expect(all[1]).toBe(13);
  expect(all[6]).toBe(2);
  expect(all[2]).toBe(0);
  // Restrict to member 1 only.
  const one = capacityBySlot(caps, "PI1-Q3", new Set([1]));
  expect(one[1]).toBe(8);
});
