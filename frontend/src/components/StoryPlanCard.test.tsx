import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Item } from "../types";
import type { CardLinkInfo } from "../lib/planningLinks";
import StoryPlanCard from "./StoryPlanCard";

const story = { id: 1, kind: "story", title: "S", assignee: null, story_points: null,
  parent_id: null } as unknown as Item;

const renderCard = (info?: CardLinkInfo) =>
  render(
    <DndContext>
      <StoryPlanCard story={story} info={info} onOpen={() => {}} />
    </DndContext>,
  );

it("shows dependency count badges", () => {
  renderCard({ blocks_count: 1, blocked_by_count: 2, related_count: 3, conflicts: [], conflictPartners: [] });
  expect(screen.getByText(/blocked by 2/i)).toBeInTheDocument();
  expect(screen.getByText(/blocks 1/i)).toBeInTheDocument();
  expect(screen.getByText(/related 3/i)).toBeInTheDocument();
});

it("shows a red ring + warning marker with a tooltip for an error conflict", () => {
  const { container } = renderCard({
    blocks_count: 0, blocked_by_count: 1, related_count: 0, conflictPartners: [],
    conflicts: [{ severity: "error", message: "Blocked by \"X\" (#9) scheduled in Iteration 5 (after this)" }],
  });
  expect(screen.getByRole("img", { name: /timeline conflict/i })).toBeInTheDocument();
  expect(screen.getByTitle(/Iteration 5/)).toBeInTheDocument();
  expect(container.querySelector(".ring-red-400")).toBeTruthy();
});

it("uses an amber ring for warnings only", () => {
  const { container } = renderCard({
    blocks_count: 0, blocked_by_count: 1, related_count: 0, conflictPartners: [],
    conflicts: [{ severity: "warning", message: "Same iteration as blocker \"X\" (#9)" }],
  });
  expect(container.querySelector(".ring-amber-400")).toBeTruthy();
  expect(container.querySelector(".ring-red-400")).toBeFalsy();
});

it("renders no badges or ring without info", () => {
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
          conflictPartners: [9],
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

it("dims the card when dimmed", () => {
  const { container } = render(
    <DndContext>
      <StoryPlanCard story={story} dimmed onOpen={() => {}} />
    </DndContext>,
  );
  expect(container.querySelector(".opacity-30")).toBeTruthy();
});
