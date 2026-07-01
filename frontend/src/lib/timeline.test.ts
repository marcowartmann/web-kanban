import { expect, it } from "vitest";
import type { Item, LinkRow } from "../types";
import { dependencyComponent, groupByFeature, layoutFlat } from "./timeline";

const feature = (id: number, over: Partial<Item> = {}): Item =>
  ({ id, kind: "feature", title: `F${id}`, position: id, planning_interval: "PI1-Q3", parent_id: null, ...over }) as unknown as Item;
const story = (id: number, parent_id: number | null, iteration: number | null, pi = "PI1-Q3"): Item =>
  ({ id, kind: "story", title: `S${id}`, parent_id, iteration, planning_interval: pi }) as unknown as Item;

it("groupByFeature buckets a feature's PI stories into backlog vs slots", () => {
  const items = [feature(1), story(10, 1, null), story(11, 1, 2), story(12, 1, 2)];
  const lanes = groupByFeature(items, "PI1-Q3", { showAll: true });
  expect(lanes).toHaveLength(1);
  expect(lanes[0].feature!.id).toBe(1);
  expect(lanes[0].backlog.map((s) => s.id)).toEqual([10]);
  expect(lanes[0].slots[2].map((s) => s.id)).toEqual([11, 12]);
});

it("groupByFeature puts parentless stories in the orphan (null) lane, last", () => {
  const items = [feature(1), story(11, 1, 1), story(99, null, 3)];
  const lanes = groupByFeature(items, "PI1-Q3", { showAll: true });
  expect(lanes[lanes.length - 1].feature).toBeNull();
  expect(lanes[lanes.length - 1].slots[3].map((s) => s.id)).toEqual([99]);
});

it("groupByFeature showAll:false hides backlog-only/empty lanes; showAll:true keeps an empty in-PI feature", () => {
  const items = [feature(1), feature(2), story(10, 1, null)]; // F1 only backlog, F2 no stories
  expect(groupByFeature(items, "PI1-Q3", { showAll: false })).toHaveLength(0);
  const all = groupByFeature(items, "PI1-Q3", { showAll: true });
  expect(all.map((l) => l.feature!.id).sort()).toEqual([1, 2]);
});

it("groupByFeature ignores other PIs", () => {
  const items = [feature(1), story(11, 1, 2, "PI2-Q4")];
  expect(groupByFeature(items, "PI1-Q3", { showAll: false })).toHaveLength(0);
});

it("layoutFlat places PI stories by iteration and everything else in backlog", () => {
  const items = [feature(1), story(11, 1, 2), story(12, 1, null), story(13, 1, 4, "PI2-Q4")];
  const out = layoutFlat(items, "PI1-Q3");
  expect(out.slots[2].map((s) => s.id)).toEqual([11]);
  expect(out.backlog.map((s) => s.id).sort()).toEqual([1, 12, 13]); // feature, unplanned, other-PI
});

it("dependencyComponent returns the transitive closure over both directions/relations", () => {
  const links: LinkRow[] = [
    { id: 1, source_id: 1, target_id: 2, relation: "blocks" },
    { id: 2, source_id: 2, target_id: 3, relation: "relates_to" },
    { id: 3, source_id: 8, target_id: 9, relation: "blocks" }, // unrelated
  ];
  const comp = dependencyComponent([], links, [3]);
  expect([...comp].sort()).toEqual([1, 2, 3]);
  expect(comp.has(8)).toBe(false);
  expect([...dependencyComponent([], links, [])]).toEqual([]);
});
