import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Item } from "../types";
import type { CardLinkInfo } from "../lib/planningLinks";
import StoryPlanCard from "./StoryPlanCard";

const story = { id: 1, kind: "story", title: "S", assignee: null, assignee_id: null, story_points: null,
  parent_id: null } as unknown as Item;

const renderCard = (info?: CardLinkInfo) =>
  render(
    <DndContext>
      <StoryPlanCard story={story} info={info} onOpen={() => {}} />
    </DndContext>,
  );

it("shows the story id like board cards do", () => {
  renderCard();
  expect(screen.getByText("#1")).toBeInTheDocument();
});

it("shows only its own id, with the parent title carrying no id", () => {
  const child = { ...story, id: 2, parent_id: 5 } as unknown as Item;
  render(
    <DndContext>
      <StoryPlanCard story={child} parentTitle="Fusion Router" onOpen={() => {}} />
    </DndContext>,
  );
  expect(screen.getByText("#2")).toBeInTheDocument();
  expect(screen.getByText(/Fusion Router/)).toBeInTheDocument();
  expect(screen.queryByText(/#5/)).not.toBeInTheDocument();
});

it("shows dependency count badges", () => {
  renderCard({ blocks_count: 1, blocked_by_count: 2, related_count: 3, conflicts: [], conflictPartners: [], linkPartners: [] });
  expect(screen.getByText(/blocked by 2/i)).toBeInTheDocument();
  expect(screen.getByText(/blocks 1/i)).toBeInTheDocument();
  expect(screen.getByText(/related 3/i)).toBeInTheDocument();
});

it("shows a red ring-3 + warning marker with a tooltip for an error conflict", () => {
  const { container } = renderCard({
    blocks_count: 0, blocked_by_count: 1, related_count: 0, conflictPartners: [], linkPartners: [],
    conflicts: [{ severity: "error", message: "Blocked by \"X\" (#9) scheduled in Iteration 5 (after this)" }],
  });
  expect(screen.getByRole("img", { name: /timeline conflict/i })).toBeInTheDocument();
  expect(screen.getByTitle(/Iteration 5/)).toBeInTheDocument();
  expect(container.querySelector(".ring-red-400")).toBeTruthy();
});

it("uses an amber ring-3 for warnings only", () => {
  const { container } = renderCard({
    blocks_count: 0, blocked_by_count: 1, related_count: 0, conflictPartners: [], linkPartners: [],
    conflicts: [{ severity: "warning", message: "Same iteration as blocker \"X\" (#9)" }],
  });
  expect(container.querySelector(".ring-amber-400")).toBeTruthy();
  expect(container.querySelector(".ring-red-400")).toBeFalsy();
});

it("renders no badges or ring-3 without info", () => {
  const { container } = renderCard();
  expect(screen.queryByText(/blocked by/i)).not.toBeInTheDocument();
  expect(container.querySelector(".ring-2")).toBeFalsy();
});

it("highlights the card + conflict partners on ⚠ hover, and clears on leave", () => {
  const onHighlight = vi.fn();
  render(
    <DndContext>
      <StoryPlanCard
        story={story}
        onHighlight={onHighlight}
        info={{
          blocks_count: 0, blocked_by_count: 1, related_count: 0,
          conflictPartners: [9], linkPartners: [9],
          conflicts: [{ severity: "error", message: "Blocked by \"X\" (#9)" }],
        }}
        onOpen={() => {}}
      />
    </DndContext>,
  );
  const warn = screen.getByRole("img", { name: /timeline conflict/i });
  fireEvent.mouseEnter(warn);
  expect(onHighlight).toHaveBeenCalledWith([1, 9]);
  fireEvent.mouseLeave(warn);
  expect(onHighlight).toHaveBeenLastCalledWith(null);
});

it("shows a dependencies icon that highlights all link partners on hover", () => {
  const onHighlight = vi.fn();
  render(
    <DndContext>
      <StoryPlanCard
        story={story}
        onHighlight={onHighlight}
        info={{
          blocks_count: 1, blocked_by_count: 0, related_count: 1,
          conflicts: [], conflictPartners: [], linkPartners: [7, 8],
        }}
        onOpen={() => {}}
      />
    </DndContext>,
  );
  const dep = screen.getByRole("img", { name: /dependencies/i });
  fireEvent.mouseEnter(dep);
  expect(onHighlight).toHaveBeenCalledWith([1, 7, 8]);
  fireEvent.mouseLeave(dep);
  expect(onHighlight).toHaveBeenLastCalledWith(null);
});

it("shows no dependencies icon when the card has no links", () => {
  renderCard({
    blocks_count: 0, blocked_by_count: 0, related_count: 0,
    conflicts: [], conflictPartners: [], linkPartners: [],
  });
  expect(screen.queryByRole("img", { name: /dependencies/i })).not.toBeInTheDocument();
});

it("dims the card when dimmed", () => {
  const { container } = render(
    <DndContext>
      <StoryPlanCard story={story} dimmed onOpen={() => {}} />
    </DndContext>,
  );
  expect(container.querySelector(".opacity-30")).toBeTruthy();
});

it("shows a blue ring-3 when selected", () => {
  const { container } = render(
    <DndContext>
      <StoryPlanCard story={story} selected onOpen={() => {}} />
    </DndContext>,
  );
  expect(container.querySelector(".ring-blue-400")).toBeTruthy();
});
