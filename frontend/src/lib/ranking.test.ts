import { describe, expect, it } from "vitest";
import { byManual, byWsjf, computeAfterId } from "./ranking";
import type { Item } from "../types";

function f(id: number, wsjf: number | null, rank: number | null): Item {
  return { id, wsjf_score: wsjf, manual_rank: rank } as Item;
}

describe("byWsjf", () => {
  it("sorts by wsjf desc, nulls last, id tiebreak", () => {
    const out = byWsjf([f(1, 5, null), f(2, 10, null), f(3, null, null), f(4, 10, null)]);
    expect(out.map((x) => x.id)).toEqual([2, 4, 1, 3]);
  });
});

describe("byManual", () => {
  it("ranked first (asc), then wsjf desc for unranked", () => {
    const out = byManual([f(1, 5, null), f(2, 20, 2), f(3, 1, 1), f(4, 8, null)]);
    expect(out.map((x) => x.id)).toEqual([3, 2, 4, 1]);
  });
});

describe("computeAfterId", () => {
  const order = [f(1, null, 1), f(2, null, 2), f(3, null, 3)];
  it("returns the id now before the moved item", () => {
    expect(computeAfterId(order, 1, 3)).toBe(3); // move 1 after 3 → [2,3,1]; anchor is 3
  });
  it("returns null when moved to the top", () => {
    expect(computeAfterId(order, 3, 1)).toBe(null); // move 3 above 1 → [3,1,2]
  });
});
