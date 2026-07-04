import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { PIObjective } from "../types";
import ObjectiveCard from "./ObjectiveCard";

const obj: PIObjective = {
  id: 1, team_id: 1, team_name: "Network", planning_interval: "PI1-Q3", title: "O1",
  description: null, state: "committed", is_key_delivery: false, position: 0,
  feature_ids: [7, 8], feature_count: 2,
};

it("lists the linked features by #id and title", () => {
  render(
    <DndContext>
      <ObjectiveCard obj={obj} linkedFeatures={[{ id: 7, title: "Alpha" }, { id: 8, title: "Beta" }]} />
    </DndContext>,
  );
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText("Beta")).toBeInTheDocument();
  expect(screen.getByText("#7")).toBeInTheDocument();
});

it("shows nothing extra when there are no linked features", () => {
  render(
    <DndContext>
      <ObjectiveCard obj={{ ...obj, feature_ids: [], feature_count: 0 }} linkedFeatures={[]} />
    </DndContext>,
  );
  expect(screen.getByText(/0 features/i)).toBeInTheDocument();
});
