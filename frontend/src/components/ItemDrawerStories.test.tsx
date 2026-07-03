import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const feature = {
  id: 5, kind: "feature", type: "Feature", title: "F", status: "Analyzing",
  wsjf_score: null, business_value: null, time_criticality: null,
  risk_reduction: null, cost_of_delay: null, job_size: null, parent_id: null,
  position: 0, description: null, iteration: null, leading_team: null,
  story_points: null, tshirt_size: null, kategorie: null, art: null,
  sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  assignee_id: null,
  akzeptanzkriterien: null, bo_stakeholder: null,
  definition_of_done: null,
  children: [{ id: 6, kind: "story", title: "Existing Story", parent_id: 5 }],
};

it("adds a child story to the feature", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(feature as never);
  const create = vi.spyOn(client, "createItem").mockResolvedValue({ id: 7 } as never);
  vi.spyOn(window, "prompt").mockReturnValue("Fresh Story");
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);

  await screen.findByText("Existing Story");
  await userEvent.click(screen.getByRole("button", { name: /add story/i }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "story", title: "Fresh Story", parent_id: 5 }),
  );
});

it("deletes a child story", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(feature as never);
  const del = vi.spyOn(client, "deleteItem").mockResolvedValue();
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);
  await screen.findByText("Existing Story");
  await userEvent.click(screen.getByRole("button", { name: /remove story 6/i }));
  expect(del).toHaveBeenCalledWith(6);
});
