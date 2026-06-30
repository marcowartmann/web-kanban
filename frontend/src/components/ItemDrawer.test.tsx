import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const item = {
  id: 5, kind: "feature", type: "Enabler Feature", title: "Teton Isolierung",
  status: "Analyzing", wsjf_score: 60, business_value: 20, time_criticality: 20,
  risk_reduction: 20, cost_of_delay: 60, job_size: 1, parent_id: null,
  position: 0, description: "isolate", iteration: "PI1-Q3", leading_team: "Network",
  story_points: null, tshirt_size: "XS", kategorie: null, art: "DP",
  sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null,
  definition_of_done: null, children: [],
};

it("loads an item and shows editable title + WSJF", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);
  expect(await screen.findByDisplayValue("Teton Isolierung")).toBeInTheDocument();
  expect(screen.getByText(/WSJF/)).toBeInTheDocument();
});

it("saves edits via updateItem then notifies", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(item as never);
  const onChanged = vi.fn();
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={onChanged} />);

  const title = await screen.findByDisplayValue("Teton Isolierung");
  await userEvent.clear(title);
  await userEvent.type(title, "Teton v2");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));

  expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ title: "Teton v2" }));
  expect(onChanged).toHaveBeenCalled();
});

it("shows a parent-feature link for a story and opens it on click", async () => {
  const story = { ...item, id: 9, kind: "story", title: "My Story", parent_id: 5 };
  const feature = { ...item, id: 5, kind: "feature", title: "Teton Isolierung" };
  vi.spyOn(client, "getItem").mockImplementation(
    async (id: number) => (id === 9 ? story : feature) as never,
  );
  const onOpenParent = vi.fn();
  render(
    <ItemDrawer
      itemId={9}
      onClose={() => {}}
      onChanged={() => {}}
      onOpenParent={onOpenParent}
    />,
  );
  await screen.findByDisplayValue("My Story");
  const link = await screen.findByRole("button", { name: /Teton Isolierung/i });
  await userEvent.click(link);
  expect(onOpenParent).toHaveBeenCalledWith(5);
});

it("renders a Back button that calls onBack when stacked", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const onBack = vi.fn();
  render(
    <ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} onBack={onBack} />,
  );
  await screen.findByDisplayValue("Teton Isolierung");
  await userEvent.click(screen.getByRole("button", { name: /back/i }));
  expect(onBack).toHaveBeenCalled();
});

it("deletes via deleteItem after confirm", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const del = vi.spyOn(client, "deleteItem").mockResolvedValue();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const onChanged = vi.fn();
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={onChanged} />);
  await screen.findByDisplayValue("Teton Isolierung");
  await userEvent.click(screen.getByRole("button", { name: /delete/i }));
  expect(del).toHaveBeenCalledWith(5);
  expect(onChanged).toHaveBeenCalled();
});
