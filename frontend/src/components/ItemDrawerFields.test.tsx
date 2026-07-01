import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const feature = {
  id: 5, kind: "feature", type: "Feature", title: "F", status: "Funnel", wsjf_score: null,
  business_value: null, time_criticality: null, risk_reduction: null, cost_of_delay: null,
  job_size: null, parent_id: null, position: 0, description: null, planning_interval: "PI1-Q3",
  iteration: null, leading_team: "Network", story_points: null, tshirt_size: null, kategorie: null,
  art: null, sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null, definition_of_done: null,
  children: [], links: [],
};

it("Status is a dropdown of the item-kind's board lanes and saves the pick", async () => {
  // status starts empty so the dropdown shows all lane options on focus
  // (SearchableSelect filters by the current value while it mirrors it).
  vi.spyOn(client, "getItem").mockResolvedValue({ ...feature, status: null } as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(feature as never);
  render(
    <ItemDrawer
      itemId={5}
      statusOptionsByKind={{ feature: ["Funnel", "Ready"] }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  const status = await screen.findByRole("combobox", { name: "Status" });
  fireEvent.focus(status);
  fireEvent.mouseDown(screen.getByText("Ready"));
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ status: "Ready" }));
});

it("keeps an off-list current planning interval selectable", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...feature, planning_interval: "LEGACY-PI" } as never);
  render(
    <ItemDrawer
      itemId={5}
      planningIntervalOptions={["PI1-Q3", "PI2-Q4"]}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  const pi = await screen.findByRole("combobox", { name: "Planning Interval" });
  expect((pi as HTMLInputElement).value).toBe("LEGACY-PI");
});
