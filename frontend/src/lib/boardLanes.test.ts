import { describe, expect, it } from "vitest";
import { buildBoardCards, groupIntoLanes, statusOptionsByKind } from "./boardLanes";
import type { Item } from "../types";

function item(over: Partial<Item> & Pick<Item, "id" | "kind">): Item {
  const defaults: Item = {
    id: 0, kind: "feature", type: null, parent_id: null, position: 0, version: 1, title: "t",
    status: null, description: null, kategorie: null, art: null, sdi_prio: null,
    tshirt_size: null, wsjf_score: null, story_points: null, planning_interval: null, iteration: null,
    leading_team: null, supporting_team: null, externer_partner: null,
    assignee: null, assignee_id: null, akzeptanzkriterien: null,
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

it("buildBoardCards counts blocks/blocked_by from links", () => {
  const items = [
    { id: 1, kind: "feature", title: "A", parent_id: null } as never,
    { id: 2, kind: "story", title: "B", parent_id: null } as never,
  ];
  const links = [{ id: 10, source_id: 1, target_id: 2, relation: "blocks" }];
  const cards = buildBoardCards(items, links);
  const a = cards.find((c) => c.id === 1)!;
  const b = cards.find((c) => c.id === 2)!;
  expect(a.blocks_count).toBe(1);
  expect(a.blocked_by_count).toBe(0);
  expect(b.blocked_by_count).toBe(1);
  expect(b.blocks_count).toBe(0);
});

it("buildBoardCards ignores non-blocks relations for counts", () => {
  const items = [{ id: 1, kind: "feature", title: "A", parent_id: null } as never];
  const cards = buildBoardCards(items, [{ id: 1, source_id: 1, target_id: 1, relation: "relates_to" }]);
  expect(cards[0].blocks_count).toBe(0);
  expect(cards[0].blocked_by_count).toBe(0);
});

it("buildBoardCards counts relates_to on both endpoints", () => {
  const items = [
    { id: 1, kind: "feature", title: "A", parent_id: null } as never,
    { id: 2, kind: "story", title: "B", parent_id: null } as never,
  ];
  const links = [{ id: 5, source_id: 1, target_id: 2, relation: "relates_to" }];
  const cards = buildBoardCards(items, links);
  expect(cards.find((c) => c.id === 1)!.related_count).toBe(1);
  expect(cards.find((c) => c.id === 2)!.related_count).toBe(1);
  // relates_to must not leak into the blocks counts
  expect(cards.find((c) => c.id === 1)!.blocks_count).toBe(0);
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

it("statusOptionsByKind maps each kind to its boards' lane names in order", () => {
  const boards = [
    { id: 1, name: "F&S", kinds: ["feature", "story"], lanes: [{ name: "Funnel" }, { name: "Ready" }] },
    { id: 2, name: "Risks", kinds: ["risk"], lanes: [{ name: "Open" }, { name: "Closed" }] },
  ] as never;
  const out = statusOptionsByKind(boards);
  expect(out.feature).toEqual(["Funnel", "Ready"]);
  expect(out.story).toEqual(["Funnel", "Ready"]);
  expect(out.risk).toEqual(["Open", "Closed"]);
});
