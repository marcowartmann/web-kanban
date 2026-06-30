import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { handleDragEnd } from "./Board";

afterEach(() => vi.restoreAllMocks());

it("moves a card to the dropped column's status and reloads", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn().mockResolvedValue(undefined);

  await handleDragEnd(
    { active: { id: 7 }, over: { id: "New" } } as never,
    reload,
  );

  expect(update).toHaveBeenCalledWith(7, { status: "New" });
  expect(reload).toHaveBeenCalled();
});

it("does nothing when dropped outside any column", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue({} as never);
  const reload = vi.fn();
  await handleDragEnd({ active: { id: 7 }, over: null } as never, reload);
  expect(update).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
