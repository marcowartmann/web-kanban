import { expect, it } from "vitest";
import type { Capacity, Item, TeamMember } from "../types";
import { loadCapacityRows, loadCapacityTotals } from "./capacity";

const member = (id: number, name: string, team_id: number | null = 1): TeamMember => ({
  id,
  name,
  team_id,
  team_name: null,
});
const cap = (member_id: number, iteration: number, points: number, pi = "PI1-Q3"): Capacity => ({
  id: member_id * 100 + iteration,
  member_id,
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
    ...over,
  }) as Item;

it("buckets each member's capacity and assigned load by iteration", () => {
  const members = [member(1, "Marco"), member(2, "Manuela")];
  const caps = [cap(1, 1, 5), cap(1, 2, 5)];
  const stories = [
    story({ id: 10, iteration: 1, story_points: 3, assignee: "Marco" }),
    story({ id: 11, iteration: 1, story_points: 2, assignee: "Marco" }), // same slot sums
    story({ id: 12, iteration: 2, story_points: 4, assignee: "Manuela" }),
  ];
  const rows = loadCapacityRows(members, caps, stories, "PI1-Q3");
  const marco = rows.find((r) => r.member?.id === 1)!;
  expect(marco.slots[1]).toEqual({ load: 5, capacity: 5 });
  expect(marco.slots[2]).toEqual({ load: 0, capacity: 5 });
  expect(marco.totalLoad).toBe(5);
  expect(marco.totalCapacity).toBe(10);
  const manuela = rows.find((r) => r.member?.id === 2)!;
  expect(manuela.slots[2]).toEqual({ load: 4, capacity: 0 });
});

it("adds an Unassigned row (last) for null/unmatched assignees, only when it has load", () => {
  const members = [member(1, "Marco")];
  const stories = [
    story({ id: 20, iteration: 3, story_points: 2, assignee: null }),
    story({ id: 21, iteration: 3, story_points: 1, assignee: "Ghost" }), // not a member
    story({ id: 22, iteration: 1, story_points: 4, assignee: "Marco" }),
  ];
  const rows = loadCapacityRows(members, [], stories, "PI1-Q3");
  const unassigned = rows.find((r) => r.member === null)!;
  expect(unassigned.slots[3]).toEqual({ load: 3, capacity: 0 });
  expect(rows[rows.length - 1].member).toBeNull();

  const none = loadCapacityRows(members, [], [story({ id: 23, iteration: 1, story_points: 4, assignee: "Marco" })], "PI1-Q3");
  expect(none.some((r) => r.member === null)).toBe(false);
});

it("ignores other-PI stories and capacities", () => {
  const rows = loadCapacityRows(
    [member(1, "Marco")],
    [cap(1, 1, 5, "PI2-Q4")],
    [story({ id: 30, iteration: 1, story_points: 3, assignee: "Marco", planning_interval: "PI2-Q4" })],
    "PI1-Q3",
  );
  expect(rows[0].slots[1]).toEqual({ load: 0, capacity: 0 });
  expect(rows[0].totalLoad).toBe(0);
});

it("loadCapacityTotals sums load and capacity per iteration including the Unassigned row", () => {
  const stories = [
    story({ id: 40, iteration: 1, story_points: 3, assignee: "Marco" }),
    story({ id: 41, iteration: 1, story_points: 2, assignee: null }),
  ];
  const rows = loadCapacityRows([member(1, "Marco")], [cap(1, 1, 5)], stories, "PI1-Q3");
  const totals = loadCapacityTotals(rows);
  expect(totals.slots[1]).toEqual({ load: 5, capacity: 5 });
  expect(totals.totalLoad).toBe(5);
  expect(totals.totalCapacity).toBe(5);
});
