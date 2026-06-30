import { describe, expect, it } from "vitest";
import { buildBoardCards, groupIntoLanes } from "./boardLanes";
import type { Item } from "../types";

function item(over: Partial<Item> & Pick<Item, "id" | "kind">): Item {
  const defaults: Item = {
    id: 0, kind: "feature", type: null, parent_id: null, position: 0, title: "t",
    status: null, description: null, kategorie: null, art: null, sdi_prio: null,
    tshirt_size: null, wsjf_score: null, story_points: null, iteration: null,
    leading_team: null, supporting_team: null, externer_partner: null,
    assignee: null, akzeptanzkriterien: null, dependencies: null,
    bo_stakeholder: null, business_value: null, time_criticality: null,
    risk_reduction: null, cost_of_delay: null, job_size: null,
    definition_of_done: null,
  };
  return { ...defaults, ...over };
}

describe("buildBoardCards", () => {
  it("computes feature children_count and children_points", () => {
    const cards = buildBoardCards([
      item({ id: 1, kind: "feature", title: "F" }),
      item({ id: 2, kind: "story", parent_id: 1, story_points: 0.5 }),
      item({ id: 3, kind: "story", parent_id: 1, story_points: 1.5 }),
    ]);
    const feature = cards.find((c) => c.id === 1)!;
    expect(feature.children_count).toBe(2);
    expect(feature.children_points).toBe(2);
  });
});

describe("groupIntoLanes", () => {
  it("places cards by status into lanes (in order) + trailing Unscheduled", () => {
    const cards = buildBoardCards([
      item({ id: 1, kind: "feature", status: "Analyzing" }),
      item({ id: 2, kind: "risk", status: "New" }),
      item({ id: 3, kind: "feature", status: "Bogus" }),
      item({ id: 4, kind: "feature", status: null }),
    ]);
    const cols = groupIntoLanes(cards, [{ name: "Funnel" }, { name: "Analyzing" }, { name: "New" }]);
    expect(cols.map((c) => c.status)).toEqual(["Funnel", "Analyzing", "New", "Unscheduled"]);
    expect(cols[1].cards.map((c) => c.id)).toEqual([1]);
    expect(cols[2].cards.map((c) => c.id)).toEqual([2]);
    // unmatched status ("Bogus") and blank both fall to Unscheduled
    expect(cols[3].cards.map((c) => c.id).sort()).toEqual([3, 4]);
    expect(cols[0].cards).toEqual([]);
  });
});
