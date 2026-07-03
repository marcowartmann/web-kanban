import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import StoryBoardModal, { handleStoryDragEnd } from "./StoryBoardModal";
import type { Item } from "../types";

afterEach(() => vi.restoreAllMocks());

function story(id: number, title: string, status: string | null) {
  return {
    id, kind: "story", type: "Enabler Story", parent_id: 5, position: id, title,
    status, description: null, kategorie: null, art: null, sdi_prio: null,
    tshirt_size: null, wsjf_score: null, story_points: null, iteration: null,
    leading_team: null, supporting_team: null, externer_partner: null,
    assignee: null, assignee_id: null, akzeptanzkriterien: null,
    bo_stakeholder: null, business_value: null, time_criticality: null,
    risk_reduction: null, cost_of_delay: null, job_size: null,
    definition_of_done: null,
  };
}

const feature = {
  id: 5, kind: "feature", type: "Feature", parent_id: null, position: 0,
  title: "Feature Five", status: "Analyzing", description: null, kategorie: null,
  art: null, sdi_prio: null, tshirt_size: null, wsjf_score: null,
  story_points: null, iteration: null, leading_team: null, supporting_team: null,
  externer_partner: null, assignee: null, assignee_id: null, akzeptanzkriterien: null,
  bo_stakeholder: null, business_value: null,
  time_criticality: null, risk_reduction: null, cost_of_delay: null,
  job_size: null, definition_of_done: null,
  children: [story(6, "Story Six", "Analyzing"), story(7, "Story Seven", null)],
};

it("renders the feature's stories as cards", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(feature as never);
  render(
    <StoryBoardModal featureId={5} onClose={() => {}} onOpenItem={() => {}} onChanged={() => {}} />,
  );
  expect(await screen.findByText("Story Six")).toBeInTheDocument();
  expect(screen.getByText("Story Seven")).toBeInTheDocument();
  // feature title in the header
  expect(screen.getByText(/Feature Five/)).toBeInTheDocument();
});

it("opens a story for editing on card click", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(feature as never);
  const onOpenItem = vi.fn();
  render(
    <StoryBoardModal featureId={5} onClose={() => {}} onOpenItem={onOpenItem} onChanged={() => {}} />,
  );
  fireEvent.click(await screen.findByText("Story Six"));
  expect(onOpenItem).toHaveBeenCalledWith(6);
});

it("adds a story with the feature as parent", async () => {
  vi.spyOn(client, "getItem").mockResolvedValue(feature as never);
  const create = vi.spyOn(client, "createItem").mockResolvedValue({ id: 8 } as never);
  vi.spyOn(window, "prompt").mockReturnValue("Fresh Story");
  const onChanged = vi.fn();
  render(
    <StoryBoardModal featureId={5} onClose={() => {}} onOpenItem={() => {}} onChanged={onChanged} />,
  );
  await screen.findByText("Story Six");
  fireEvent.click(screen.getByRole("button", { name: /add story/i }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "story", title: "Fresh Story", parent_id: 5 }),
  );
});

it("drag handler patches the dropped story's status then reloads", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn().mockResolvedValue(undefined);
  const items = [{ id: 6, version: 1 } as unknown as Item];
  await handleStoryDragEnd(
    { active: { id: 6 }, over: { id: "New" } } as never,
    items,
    reload,
  );
  expect(update).toHaveBeenCalledWith(6, { status: "New", version: 1 });
  expect(reload).toHaveBeenCalled();
});
