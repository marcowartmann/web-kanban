import { expect, it } from "vitest";
import type { Capacity, TeamMember } from "../types";
import { capacityColumnTotals, memberCapacityRows } from "./capacity";

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

it("buckets each member's capacity by iteration for the PI, summing and ignoring others", () => {
  const members = [member(1, "Marco"), member(2, "Manuela")];
  const caps = [
    cap(1, 1, 5),
    cap(1, 2, 5),
    cap(1, 2, 3), // same slot sums
    cap(2, 1, 3),
    cap(1, 3, 4, "PI2-Q4"), // other PI ignored
  ];
  const rows = memberCapacityRows(members, caps, "PI1-Q3");
  const marco = rows.find((r) => r.member.id === 1)!;
  expect(marco.slots[1]).toBe(5);
  expect(marco.slots[2]).toBe(8);
  expect(marco.slots[3]).toBe(0);
  expect(marco.total).toBe(13);
  expect(rows.find((r) => r.member.id === 2)!.total).toBe(3);
});

it("yields all-zero slots for a member with no capacity", () => {
  const rows = memberCapacityRows([member(9, "New")], [], "PI1-Q3");
  expect(rows[0].total).toBe(0);
  expect(rows[0].slots[1]).toBe(0);
});

it("capacityColumnTotals sums each iteration across rows", () => {
  const rows = memberCapacityRows([member(1, "Marco"), member(2, "Manuela")], [cap(1, 1, 5), cap(1, 2, 5), cap(2, 1, 3)], "PI1-Q3");
  const totals = capacityColumnTotals(rows);
  expect(totals.slots[1]).toBe(8);
  expect(totals.slots[2]).toBe(5);
  expect(totals.total).toBe(13);
});

it("capacityColumnTotals of empty rows is all zeros", () => {
  const totals = capacityColumnTotals([]);
  expect(totals.total).toBe(0);
  expect(totals.slots[6]).toBe(0);
});
