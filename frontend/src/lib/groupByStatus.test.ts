import { describe, expect, it } from "vitest";
import { groupByStatus } from "./groupByStatus";
import type { Item } from "../types";

function story(id: number, title: string, status: string | null): Item {
  return {
    id, kind: "story", type: "Enabler Story", parent_id: 1, position: id, title,
    status, description: null, kategorie: null, art: null, sdi_prio: null,
    tshirt_size: null, wsjf_score: null, story_points: null, iteration: null,
    leading_team: null, supporting_team: null, externer_partner: null,
    assignee: null, akzeptanzkriterien: null, dependencies: null,
    bo_stakeholder: null, business_value: null, time_criticality: null,
    risk_reduction: null, cost_of_delay: null, job_size: null,
    definition_of_done: null,
  };
}

describe("groupByStatus", () => {
  it("orders Funnel, Analyzing, New, other statuses A-Z, then Unscheduled", () => {
    const cols = groupByStatus([
      story(1, "a", "New"),
      story(2, "b", "Funnel"),
      story(3, "c", "Zebra"),
      story(4, "d", "Analyzing"),
      story(5, "e", null),
    ]);
    expect(cols.map((c) => c.status)).toEqual([
      "Funnel", "Analyzing", "New", "Zebra", "Unscheduled",
    ]);
  });

  it("maps blank/whitespace status to Unscheduled and produces BoardCards", () => {
    const cols = groupByStatus([story(1, "x", "  ")]);
    expect(cols).toHaveLength(1);
    expect(cols[0].status).toBe("Unscheduled");
    expect(cols[0].cards[0].title).toBe("x");
    expect(cols[0].cards[0].children_count).toBe(0);
  });
});
