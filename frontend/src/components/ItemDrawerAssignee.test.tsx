import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const item = {
  id: 5, kind: "feature", type: "Feature", title: "F", status: "Analyzing",
  wsjf_score: null, business_value: null, time_criticality: null,
  risk_reduction: null, cost_of_delay: null, job_size: null, parent_id: null,
  position: 0, description: null, iteration: null, leading_team: null,
  story_points: null, tshirt_size: null, kategorie: null, art: null,
  sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null,
  definition_of_done: null, children: [],
};

it("assigns a team member from the strict dropdown and saves it", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(item as never);
  render(
    <ItemDrawer
      itemId={5}
      assigneeOptions={["Marco Wartmann", "Adrian Senn"]}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  await screen.findByDisplayValue("F");
  fireEvent.focus(screen.getByRole("combobox", { name: "Assignee" }));
  fireEvent.mouseDown(screen.getByText("Marco Wartmann"));
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ assignee: "Marco Wartmann" }));
});
