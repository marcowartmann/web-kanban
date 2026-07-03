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
  assignee_id: null,
  akzeptanzkriterien: null, bo_stakeholder: null,
  definition_of_done: null, children: [],
};

const people = [{ id: 7, display_name: "Worker", team_id: null }];

it("assigns a person from the strict dropdown and saves it by id", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(item as never);
  render(
    <ItemDrawer
      itemId={5}
      people={people}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  await screen.findByDisplayValue("F");
  fireEvent.focus(screen.getByRole("combobox", { name: "Assignee" }));
  fireEvent.mouseDown(screen.getByText("Worker"));
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ assignee_id: 7 }));
});

it("clears the assignee and saves a null id", async () => {
  const assigned = { ...item, assignee: "Worker", assignee_id: 7 };
  vi.spyOn(client, "getItem").mockResolvedValue(assigned as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(assigned as never);
  render(
    <ItemDrawer
      itemId={5}
      people={people}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  await screen.findByDisplayValue("F");
  fireEvent.click(screen.getByRole("button", { name: "Clear Assignee" }));
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ assignee_id: null }));
});
