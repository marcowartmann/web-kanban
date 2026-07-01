import { afterEach, describe, expect, it, vi } from "vitest";
import { createItem, createLink, createTeamMember, deleteLink, getBoards, getTeams, importCsv, listLinks, reorderLanes, updateItem } from "./client";
import { createPlanningInterval, deletePlanningInterval, getPlanningIntervals } from "./client";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  const nullBodyStatuses = new Set([204, 205, 304]);
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(nullBodyStatuses.has(status) ? null : (typeof body === "string" ? body : JSON.stringify(body)), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("api client", () => {
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

  it("createLink posts the edge body", async () => {
    const spy = mockFetch(201, { id: 1, source_id: 2, target_id: 3, relation: "blocks" });
    await createLink({ source_id: 2, target_id: 3, relation: "blocks" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/links");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ source_id: 2, target_id: 3, relation: "blocks" });
  });

  it("deleteLink sends DELETE", async () => {
    const spy = mockFetch(204, "");
    await deleteLink(7);
    expect(spy.mock.calls[0][0]).toBe("/api/links/7");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("listLinks fetches all edges", async () => {
    mockFetch(200, [{ id: 1, source_id: 2, target_id: 3, relation: "blocks" }]);
    const rows = await listLinks();
    expect(rows).toHaveLength(1);
  });

  it("getPlanningIntervals fetches the list", async () => {
    mockFetch(200, [{ id: 1, name: "PI1-Q3", position: 0 }]);
    expect(await getPlanningIntervals()).toHaveLength(1);
  });

  it("createPlanningInterval posts the name", async () => {
    const spy = mockFetch(201, { id: 2, name: "PI2-Q4", position: 1 });
    await createPlanningInterval("PI2-Q4");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/planning-intervals");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "PI2-Q4" });
  });

  it("deletePlanningInterval sends DELETE", async () => {
    const spy = mockFetch(204, "");
    await deletePlanningInterval(5);
    expect(spy.mock.calls[0][0]).toBe("/api/planning-intervals/5");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });
});
