import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { Item } from "../types";
import ObjectiveEditor from "./ObjectiveEditor";

afterEach(() => vi.restoreAllMocks());

const feature = (id: number, over: Partial<Item> = {}): Item =>
  ({ id, kind: "feature", title: `F${id}`, leading_team: "Network", planning_interval: "PI1-Q3", ...over } as unknown as Item);

it("creates an objective; Key Delivery is disabled unless committed; features scoped to team+PI", async () => {
  const create = vi.spyOn(client, "createPIObjective").mockResolvedValue({ id: 9 } as never);
  const setFeatures = vi.spyOn(client, "setObjectiveFeatures").mockResolvedValue({ id: 9 } as never);
  render(
    <ObjectiveEditor
      teamId={1}
      teamName="Network"
      planningInterval="PI1-Q3"
      features={[feature(7), feature(8, { leading_team: "Cloud" })]}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
  // Only same-team+PI features are offered.
  expect(screen.getByLabelText("F7")).toBeInTheDocument();
  expect(screen.queryByLabelText("F8")).toBeNull();

  expect(screen.getByLabelText(/key delivery/i)).toBeDisabled(); // default uncommitted
  await userEvent.type(screen.getByLabelText(/title/i), "Objective A");
  await userEvent.click(screen.getByLabelText("F7"));
  await userEvent.click(screen.getByRole("button", { name: /save/i }));

  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
    team_id: 1, planning_interval: "PI1-Q3", title: "Objective A", state: "uncommitted", is_key_delivery: false,
  })));
  await waitFor(() => expect(setFeatures).toHaveBeenCalledWith(9, [7]));
});

it("filters the linked-feature list by search", async () => {
  render(
    <ObjectiveEditor
      teamId={1}
      teamName="Network"
      planningInterval="PI1-Q3"
      features={[feature(7, { title: "Alpha" }), feature(9, { title: "Beta" })]}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
  expect(screen.getByLabelText("Alpha")).toBeInTheDocument();
  expect(screen.getByLabelText("Beta")).toBeInTheDocument();
  await userEvent.type(screen.getByPlaceholderText(/search features/i), "alph");
  expect(screen.getByLabelText("Alpha")).toBeInTheDocument();
  expect(screen.queryByLabelText("Beta")).toBeNull();
});
