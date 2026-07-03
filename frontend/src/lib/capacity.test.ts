import { expect, it } from "vitest";
import type { Capacity, Item, PersonOption } from "../types";
import { loadCapacityRows, loadCapacityTotals } from "./capacity";

const person = (id: number, display_name: string): PersonOption => ({
  id,
  display_name,
  team_id: null, // the lib itself never filters by team
});
const cap = (user_id: number, iteration: number, points: number, pi = "PI1-Q3"): Capacity => ({
  id: user_id * 100 + iteration,
  user_id,
  planning_interval: pi,
  iteration,
  points,
});
const story = (over: Partial<Item>): Item =>
  ({
    id: 1,
    kind: "story",
    title: "S",
    planning_interval: "PI1-Q3",
    iteration: null,
    story_points: null,
    assignee: null,
    assignee_id: null,
    ...over,
  }) as Item;

it("buckets each person's capacity and assigned load by iteration", () => {
  const people = [person(1, "Marco"), person(2, "Manuela")];
  const caps = [cap(1, 1, 5), cap(1, 2, 5)];
  const stories = [
    story({ id: 10, iteration: 1, story_points: 3, assignee: "Marco", assignee_id: 1 }),
    story({ id: 11, iteration: 1, story_points: 2, assignee: "Marco", assignee_id: 1 }), // same slot sums
    story({ id: 12, iteration: 2, story_points: 4, assignee: "Manuela", assignee_id: 2 }),
  ];
  const rows = loadCapacityRows(people, caps, stories, "PI1-Q3");
  const marco = rows.find((r) => r.person?.id === 1)!;
  expect(marco.slots[1]).toEqual({ load: 5, capacity: 5 });
  expect(marco.slots[2]).toEqual({ load: 0, capacity: 5 });
  expect(marco.totalLoad).toBe(5);
  expect(marco.totalCapacity).toBe(10);
  const manuela = rows.find((r) => r.person?.id === 2)!;
  expect(manuela.slots[2]).toEqual({ load: 4, capacity: 0 });
});

it("adds an Unassigned row (last) for null/unmatched assignees, only when it has load", () => {
  const people = [person(1, "Marco")];
  const stories = [
    story({ id: 20, iteration: 3, story_points: 2, assignee: null }),
    story({ id: 21, iteration: 3, story_points: 1, assignee: "Ghost", assignee_id: 3 }), // not a known person
    story({ id: 22, iteration: 1, story_points: 4, assignee: "Marco", assignee_id: 1 }),
  ];
  const rows = loadCapacityRows(people, [], stories, "PI1-Q3");
  const unassigned = rows.find((r) => r.person === null)!;
  expect(unassigned.slots[3]).toEqual({ load: 3, capacity: 0 });
  expect(rows[rows.length - 1].person).toBeNull();

  const none = loadCapacityRows(people, [], [story({ id: 23, iteration: 1, story_points: 4, assignee: "Marco", assignee_id: 1 })], "PI1-Q3");
  expect(none.some((r) => r.person === null)).toBe(false);
});

it("ignores other-PI stories and capacities", () => {
  const rows = loadCapacityRows(
    [person(1, "Marco")],
    [cap(1, 1, 5, "PI2-Q4")],
    [story({ id: 30, iteration: 1, story_points: 3, assignee: "Marco", assignee_id: 1, planning_interval: "PI2-Q4" })],
    "PI1-Q3",
  );
  expect(rows[0].slots[1]).toEqual({ load: 0, capacity: 0 });
  expect(rows[0].totalLoad).toBe(0);
});

it("loadCapacityTotals sums load and capacity per iteration including the Unassigned row", () => {
  const stories = [
    story({ id: 40, iteration: 1, story_points: 3, assignee: "Marco", assignee_id: 1 }),
    story({ id: 41, iteration: 1, story_points: 2, assignee: null }),
  ];
  const rows = loadCapacityRows([person(1, "Marco")], [cap(1, 1, 5)], stories, "PI1-Q3");
  const totals = loadCapacityTotals(rows);
  expect(totals.slots[1]).toEqual({ load: 5, capacity: 5 });
  expect(totals.totalLoad).toBe(5);
  expect(totals.totalCapacity).toBe(5);
});
