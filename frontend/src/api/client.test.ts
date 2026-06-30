import { afterEach, describe, expect, it, vi } from "vitest";
import { createItem, createTeamMember, getBoard, getBoards, getTeams, importCsv, reorderLanes, updateItem } from "./client";

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

  it("getTeams fetches /api/teams", async () => {
    const spy = mockFetch(200, [{ id: 1, name: "Network" }]);
    const teams = await getTeams();
    expect(spy).toHaveBeenCalledWith("/api/teams", undefined);
    expect(teams[0].name).toBe("Network");
  });

  it("createTeamMember posts name + team_id", async () => {
    const spy = mockFetch(201, { id: 1, name: "Marco", team_id: 2, team_name: "Network" });
    await createTeamMember({ name: "Marco", team_id: 2 });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/team-members");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "Marco", team_id: 2 });
  });

  it("getBoards fetches /api/boards", async () => {
    const spy = mockFetch(200, [{ id: 1, name: "Main", kinds: ["feature"], position: 0, lanes: [] }]);
    const boards = await getBoards();
    expect(spy).toHaveBeenCalledWith("/api/boards", undefined);
    expect(boards[0].name).toBe("Main");
  });

  it("reorderLanes PUTs lane_ids", async () => {
    const spy = mockFetch(200, []);
    await reorderLanes(7, [3, 1, 2]);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/boards/7/lanes/order");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ lane_ids: [3, 1, 2] });
  });
});
