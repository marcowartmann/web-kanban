import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const base = {
  id: 5, kind: "feature", type: null, title: "A", status: "New", wsjf_score: null,
  business_value: null, time_criticality: null, risk_reduction: null, cost_of_delay: null,
  job_size: null, parent_id: null, position: 0, description: null, planning_interval: null,
  iteration: null, leading_team: null, story_points: null, tshirt_size: null, kategorie: null,
  art: null, sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null, definition_of_done: null,
  children: [],
};

const relations = [
  { relation: "blocks", direction: "outgoing", label: "blocks" },
  { relation: "blocks", direction: "incoming", label: "blocked by" },
  { relation: "relates_to", direction: "both", label: "relates to" },
];

beforeEach(() => {
  vi.spyOn(client, "getLinkRelations").mockResolvedValue(relations as never);
  vi.spyOn(client, "listItems").mockResolvedValue([
    { ...base, id: 9, title: "Other" },
  ] as never);
});

it("renders existing links grouped by label and deletes on ×", async () => {
  const item = {
    ...base,
    links: [{ link_id: 1, relation: "blocks", direction: "incoming", label: "blocked by",
      item: { id: 9, title: "Other", kind: "story", status: null, planning_interval: null } }],
  };
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const del = vi.spyOn(client, "deleteLink").mockResolvedValue(undefined as never);

  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);
  expect(await screen.findByText("blocked by")).toBeInTheDocument();
  expect(screen.getByText("Other")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /remove link 1/i }));
  expect(del).toHaveBeenCalledWith(1);
});

it("opens the linked item on row click", async () => {
  const item = {
    ...base,
    links: [{ link_id: 1, relation: "blocks", direction: "incoming", label: "blocked by",
      item: { id: 9, title: "Other", kind: "story", status: null, planning_interval: null } }],
  };
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  const onOpenItem = vi.fn();
  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} onOpenItem={onOpenItem} />);
  await userEvent.click(await screen.findByRole("button", { name: /Other/ }));
  expect(onOpenItem).toHaveBeenCalledWith(9);
});

it("adds an outgoing 'blocks' link with current item as source", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...base, links: [] } as never);
  const create = vi.spyOn(client, "createLink").mockResolvedValue({ id: 2 } as never);

  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);
  // choose relation "blocks", then pick the target item "Other (#9)"
  await userEvent.click(await screen.findByRole("button", { name: /add dependency/i }));
  await userEvent.click(screen.getByRole("option", { name: "blocks" }));
  await userEvent.click(screen.getByRole("button", { name: /choose item/i }));
  await userEvent.click(screen.getByText("Other (#9)"));

  expect(create).toHaveBeenCalledWith({ source_id: 5, target_id: 9, relation: "blocks" });
});

it("adds an incoming 'blocked by' link with current item as target", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...base, links: [] } as never);
  const create = vi.spyOn(client, "createLink").mockResolvedValue({ id: 3 } as never);

  render(<ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /add dependency/i }));
  await userEvent.click(screen.getByRole("option", { name: "blocked by" }));
  await userEvent.click(screen.getByRole("button", { name: /choose item/i }));
  await userEvent.click(screen.getByText("Other (#9)"));

  expect(create).toHaveBeenCalledWith({ source_id: 9, target_id: 5, relation: "blocks" });
});

it("calls onLinksChanged after adding a link (so board badges refresh)", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...base, links: [] } as never);
  vi.spyOn(client, "createLink").mockResolvedValue({ id: 2 } as never);
  const onLinksChanged = vi.fn();

  render(
    <ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} onLinksChanged={onLinksChanged} />,
  );
  await userEvent.click(await screen.findByRole("button", { name: /add dependency/i }));
  await userEvent.click(screen.getByRole("option", { name: "blocks" }));
  await userEvent.click(screen.getByRole("button", { name: /choose item/i }));
  await userEvent.click(screen.getByText("Other (#9)"));

  expect(onLinksChanged).toHaveBeenCalled();
});

it("calls onLinksChanged after removing a link", async () => {
  const item = {
    ...base,
    links: [{ link_id: 1, relation: "blocks", direction: "incoming", label: "blocked by",
      item: { id: 9, title: "Other", kind: "story", status: null, planning_interval: null } }],
  };
  vi.spyOn(client, "getItem").mockResolvedValue(item as never);
  vi.spyOn(client, "deleteLink").mockResolvedValue(undefined as never);
  const onLinksChanged = vi.fn();

  render(
    <ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} onLinksChanged={onLinksChanged} />,
  );
  await userEvent.click(await screen.findByRole("button", { name: /remove link 1/i }));
  expect(onLinksChanged).toHaveBeenCalled();
});
