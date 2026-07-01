import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { FeatureLane } from "../lib/timeline";
import type { Item } from "../types";
import TimelineLane, { type TimelineColumn } from "./TimelineLane";

const feature = { id: 1, kind: "feature", type: "Feature", title: "Auth" } as unknown as Item;
const story = (id: number, iteration: number) =>
  ({ id, kind: "story", title: `S${id}`, iteration, parent_id: 1 }) as unknown as Item;

const columns: TimelineColumn[] = [
  { slot: "backlog", label: "Backlog" },
  { slot: 1, label: "Iteration 1" },
  { slot: 2, label: "Iteration 2" },
];

it("renders the feature header and places stories in their iteration cells", () => {
  const lane: FeatureLane = {
    feature,
    backlog: [],
    slots: { 1: [story(11, 1)], 2: [story(12, 2)], 3: [], 4: [], 5: [], 6: [] },
  };
  render(
    <DndContext>
      <TimelineLane
        lane={lane}
        columns={columns}
        cardInfo={new Map()}
        onOpenCard={() => {}}
        onOpenFeature={() => {}}
      />
    </DndContext>,
  );
  expect(screen.getByText("Auth")).toBeInTheDocument();
  expect(screen.getByText("S11")).toBeInTheDocument();
  expect(screen.getByText("S12")).toBeInTheDocument();
});

it("renders a 'No feature' header for the orphan lane", () => {
  const lane: FeatureLane = { feature: null, backlog: [], slots: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } };
  render(
    <DndContext>
      <TimelineLane lane={lane} columns={columns} cardInfo={new Map()} onOpenCard={() => {}} onOpenFeature={() => {}} />
    </DndContext>,
  );
  expect(screen.getByText(/no feature/i)).toBeInTheDocument();
});
