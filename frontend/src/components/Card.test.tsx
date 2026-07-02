import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import Card from "./Card";
import type { BoardCard } from "../types";

function card(overrides: Partial<BoardCard>): BoardCard {
  return {
    id: 1, kind: "feature", type: "Feature", parent_id: null, position: 0, version: 1,
    title: "F", status: "Analyzing", description: null, kategorie: null,
    art: null, sdi_prio: null, tshirt_size: null, wsjf_score: null,
    story_points: null, planning_interval: null, iteration: null, leading_team: null,
    supporting_team: null, externer_partner: null, assignee: null,
    akzeptanzkriterien: null, bo_stakeholder: null,
    business_value: null, time_criticality: null, risk_reduction: null,
    cost_of_delay: null, job_size: null, definition_of_done: null,
    children_count: 3, children_points: 0, ...overrides,
  };
}

// Card uses useDraggable, which requires a DndContext ancestor.
function renderCard(props: Parameters<typeof Card>[0]) {
  return render(
    <DndContext>
      <Card {...props} />
    </DndContext>,
  );
}

afterEach(() => vi.restoreAllMocks());

it("feature card: Stories button calls onOpenStories, not onOpen", async () => {
  const onOpen = vi.fn();
  const onOpenStories = vi.fn();
  renderCard({ card: card({ kind: "feature", children_count: 3 }), onOpen, onOpenStories });
  await userEvent.click(screen.getByRole("button", { name: /stories \(3\)/i }));
  expect(onOpenStories).toHaveBeenCalledWith(1);
  expect(onOpen).not.toHaveBeenCalled();
});

it("story card: no Stories button", () => {
  renderCard({
    card: card({ id: 2, kind: "story", type: "Enabler Story", title: "S" }),
    onOpen: vi.fn(),
    onOpenStories: vi.fn(),
  });
  expect(screen.queryByRole("button", { name: /stories \(/i })).toBeNull();
});

it("shows the globally-unique number as #<id>", () => {
  renderCard({
    card: card({ id: 12 }),
    onOpen: vi.fn(),
    onOpenStories: vi.fn(),
  });
  expect(screen.getByText("#12")).toBeInTheDocument();
});

it("shows the assignee when set", () => {
  renderCard({
    card: card({ assignee: "Marco Wartmann" }),
    onOpen: vi.fn(),
    onOpenStories: vi.fn(),
  });
  expect(screen.getByText("Marco Wartmann")).toBeInTheDocument();
});

it("shows a blocked-by badge when blocked_by_count > 0", () => {
  const c = { id: 1, kind: "story", title: "S", type: null, status: "New",
    parent_id: null, position: 0, wsjf_score: null, children_count: 0, children_points: 0,
    blocked_by_count: 2, blocks_count: 0 } as never;
  render(<DndContext><Card card={c} onOpen={() => {}} /></DndContext>);
  expect(screen.getByText(/blocked by 2/i)).toBeInTheDocument();
});

it("hides the blocked-by badge when count is 0", () => {
  const c = { id: 1, kind: "story", title: "S", type: null, status: "New",
    parent_id: null, position: 0, wsjf_score: null, children_count: 0, children_points: 0,
    blocked_by_count: 0, blocks_count: 0 } as never;
  render(<DndContext><Card card={c} onOpen={() => {}} /></DndContext>);
  expect(screen.queryByText(/blocked by/i)).not.toBeInTheDocument();
});

it("shows a blocks badge when blocks_count > 0", () => {
  const c = { id: 1, kind: "story", title: "S", type: null, status: "New",
    parent_id: null, position: 0, wsjf_score: null, children_count: 0, children_points: 0,
    blocked_by_count: 0, blocks_count: 3 } as never;
  render(<DndContext><Card card={c} onOpen={() => {}} /></DndContext>);
  expect(screen.getByText(/blocks 3/i)).toBeInTheDocument();
});

it("shows a related badge when related_count > 0", () => {
  const c = { id: 1, kind: "story", title: "S", type: null, status: "New",
    parent_id: null, position: 0, wsjf_score: null, children_count: 0, children_points: 0,
    blocked_by_count: 0, blocks_count: 0, related_count: 2 } as never;
  render(<DndContext><Card card={c} onOpen={() => {}} /></DndContext>);
  expect(screen.getByText(/related 2/i)).toBeInTheDocument();
});
