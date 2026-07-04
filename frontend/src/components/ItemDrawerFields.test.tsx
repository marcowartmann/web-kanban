import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  assignee_id: null,
  akzeptanzkriterien: null, bo_stakeholder: null, definition_of_done: null,
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
  await userEvent.selectOptions(status, "Ready");
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ status: "Ready" }));
});

it("Container options are scoped to the item's PI + leading team and save container_id", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(feature as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(feature as never);
  render(
    <ItemDrawer
      itemId={5}
      teams={[{ id: 1, name: "Network" }, { id: 2, name: "Cloud" }]}
      containers={[
        { id: 1, name: "Operations", planning_interval: "PI1-Q3", team_id: 1 },
        { id: 2, name: "Old Operations", planning_interval: "PI0", team_id: 1 },
        { id: 3, name: "Cloud Ops", planning_interval: "PI1-Q3", team_id: 2 },
      ]}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  const container = await screen.findByRole("combobox", { name: "Container" });
  // Only the (PI1-Q3, Network) container is offered.
  expect(screen.queryByText("Old Operations")).toBeNull();
  expect(screen.queryByText("Cloud Ops")).toBeNull();
  await userEvent.selectOptions(container, "Operations");
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ container_id: 1 }));
});

it("Container shows a hint until PI and leading team are set", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...feature, leading_team: null } as never);
  render(
    <ItemDrawer
      itemId={5}
      teams={[{ id: 1, name: "Network" }]}
      containers={[{ id: 1, name: "Operations", planning_interval: "PI1-Q3", team_id: 1 }]}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(
    await screen.findByText(/set planning interval and leading team first/i),
  ).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Container" })).toBeNull();
});

it("Department options are scoped to the item's leading team and save department_id", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...feature, department_id: null } as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(feature as never);
  render(
    <ItemDrawer
      itemId={5}
      teams={[{ id: 1, name: "Network" }, { id: 2, name: "Cloud" }]}
      departments={[
        { id: 3, name: "FE", team_id: 1, team_name: "Network", member_ids: [] },
        { id: 4, name: "Cloud-FE", team_id: 2, team_name: "Cloud", member_ids: [] },
      ]}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  const dep = await screen.findByRole("combobox", { name: "Department" });
  expect(screen.queryByText("Cloud-FE")).toBeNull(); // other team's dept not offered
  await userEvent.selectOptions(dep, "FE");
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ department_id: 3 }));
});

it("Department field is hidden for risk items", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...feature, kind: "risk", department_id: null } as never);
  render(
    <ItemDrawer
      itemId={5}
      teams={[{ id: 1, name: "Network" }]}
      departments={[{ id: 3, name: "FE", team_id: 1, team_name: "Network", member_ids: [] }]}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  await screen.findByRole("button", { name: /save/i });
  expect(screen.queryByRole("combobox", { name: "Department" })).toBeNull();
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
  expect((pi as HTMLSelectElement).value).toBe("LEGACY-PI");
});
