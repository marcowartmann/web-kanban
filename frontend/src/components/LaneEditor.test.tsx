import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import LaneEditor, { handleLaneDragEnd } from "./LaneEditor";
import type { Board } from "../types";

afterEach(() => vi.restoreAllMocks());

const board: Board = {
  id: 1, name: "Main", kinds: ["feature"], position: 0,
  lanes: [
    { id: 10, name: "Funnel", position: 0 },
    { id: 11, name: "Analyzing", position: 1 },
    { id: 12, name: "New", position: 2 },
  ],
};

it("adds a lane with the typed name", async () => {
  const add = vi.spyOn(client, "addLane").mockResolvedValue({ id: 13, name: "Done", position: 3 });
  const onChanged = vi.fn();
  render(<LaneEditor board={board} onChanged={onChanged} />);
  fireEvent.change(screen.getByPlaceholderText(/new lane/i), { target: { value: "Done" } });
  fireEvent.click(screen.getByRole("button", { name: /add lane/i }));
  expect(add).toHaveBeenCalledWith(1, "Done");
});

it("deletes a lane", async () => {
  const del = vi.spyOn(client, "deleteLane").mockResolvedValue();
  render(<LaneEditor board={board} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /delete lane 11/i }));
  expect(del).toHaveBeenCalledWith(11);
});

it("renames a lane on blur-sm", async () => {
  const rename = vi.spyOn(client, "renameLane").mockResolvedValue({ id: 10, name: "Backlog", position: 0 });
  render(<LaneEditor board={board} onChanged={() => {}} />);
  const input = screen.getByDisplayValue("Funnel");
  fireEvent.change(input, { target: { value: "Backlog" } });
  fireEvent.blur(input);
  expect(rename).toHaveBeenCalledWith(10, "Backlog");
});

it("drag handler persists the reordered lane ids", async () => {
  const reorder = vi.spyOn(client, "reorderLanes").mockResolvedValue([]);
  const onChanged = vi.fn();
  // move lane 12 (New) to where lane 10 (Funnel) is -> [12,10,11]
  await handleLaneDragEnd({ active: { id: 12 }, over: { id: 10 } } as never, board, onChanged);
  expect(reorder).toHaveBeenCalledWith(1, [12, 10, 11]);
  expect(onChanged).toHaveBeenCalled();
});
