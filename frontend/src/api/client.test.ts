import { afterEach, describe, expect, it, vi } from "vitest";
import { createItem, getBoard, importCsv, updateItem } from "./client";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("api client", () => {
  it("getBoard fetches /api/board", async () => {
    const spy = mockFetch(200, [{ status: "Analyzing", cards: [] }]);
    const board = await getBoard();
    expect(spy).toHaveBeenCalledWith("/api/board", undefined);
    expect(board[0].status).toBe("Analyzing");
  });

  it("updateItem sends PATCH with JSON body", async () => {
    const spy = mockFetch(200, { id: 1, status: "New" });
    await updateItem(1, { status: "New" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/items/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ status: "New" });
  });

  it("createItem posts to /api/items", async () => {
    const spy = mockFetch(201, { id: 9, title: "X" });
    await createItem({ kind: "feature", title: "X" });
    expect(spy.mock.calls[0][1]?.method).toBe("POST");
  });

  it("importCsv posts multipart form data", async () => {
    const spy = mockFetch(200, { features: 1, stories: 0, risks: 0, warnings: [] });
    const file = new File(["Title\nX"], "p.csv", { type: "text/csv" });
    const result = await importCsv(file);
    expect(result.features).toBe(1);
    expect(spy.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  it("throws on non-ok responses", async () => {
    mockFetch(404, "Item not found");
    await expect(updateItem(1, {})).rejects.toThrow("404");
  });
});
