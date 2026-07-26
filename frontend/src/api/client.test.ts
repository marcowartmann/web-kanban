import { afterEach, describe, expect, it, vi } from "vitest";
import { createItem, createLink, deleteLink, getBoards, getTeams, importCsv, listItems, listLinks, listSnapshots, previewImport, reorderLanes, restoreSnapshot, updateItem } from "./client";
import { createPlanningInterval, deletePlanningInterval, getPlanningIntervals } from "./client";
import { deleteUser, getPersonOptions } from "./client";
import {
  addServiceDependency,
  createArt,
  createProduct,
  createService,
  deleteArt,
  deleteProduct,
  deleteService,
  getArts,
  getProduct,
  getProductServices,
  getProducts,
  getServiceDependencies,
  getServiceOptions,
  removeServiceDependency,
  updateArt,
  updateProduct,
  updateService,
} from "./client";
import {
  addServiceTechComponent,
  addServiceTechSystem,
  createComponent,
  createSystem,
  deleteComponent,
  deleteSystem,
  getLifecycle,
  getProductComponents,
  getProductSystems,
  getServiceTech,
  getSystems,
  getVendors,
  removeServiceTechComponent,
  removeServiceTechSystem,
  removeSystemMember,
  setSystemMember,
  updateComponent,
  updateSystem,
} from "./client";

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
    await updateItem(1, { status: "New", version: 1 });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/items/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ status: "New", version: 1 });
  });

  it("createItem posts to /api/v1/items", async () => {
    const spy = mockFetch(201, { id: 9, title: "X" });
    await createItem({ kind: "feature", title: "X" });
    expect(spy.mock.calls[0][1]?.method).toBe("POST");
  });

  it("importCsv posts multipart form data with the preview guards", async () => {
    const spy = mockFetch(200, { features: 1, stories: 0, risks: 0, warnings: [] });
    const file = new File(["Title\nX"], "p.csv", { type: "text/csv" });
    const result = await importCsv(file, "stamp123", "sha456");
    expect(result.features).toBe(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/import");
    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("file")).toBe(file);
    expect(body.get("state_stamp")).toBe("stamp123");
    expect(body.get("file_sha256")).toBe("sha456");
  });

  it("previewImport posts the file to /api/v1/import/preview", async () => {
    const spy = mockFetch(200, {
      file_sha256: "s", state_stamp: "t",
      incoming: { features: 1, stories: 2, risks: 0, warnings: [] },
      current: { features: 0, stories: 0, risks: 0, comments: 0, links: 0 },
      added_titles: [], removed_titles: [], added_more: 0, removed_more: 0,
    });
    const file = new File(["Title\nX"], "p.csv", { type: "text/csv" });
    const preview = await previewImport(file);
    expect(preview.state_stamp).toBe("t");
    expect(spy.mock.calls[0][0]).toBe("/api/v1/import/preview");
    expect(spy.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  it("listSnapshots unwraps the snapshots array", async () => {
    const spy = mockFetch(200, {
      snapshots: [{ name: "import-snapshot-20260702T120000-000000Z.json", created_at: "c", actor: "a", items: 1, comments: 0, links: 0 }],
    });
    const list = await listSnapshots();
    expect(spy).toHaveBeenCalledWith("/api/v1/import/snapshots", undefined);
    expect(list).toHaveLength(1);
    expect(list[0].items).toBe(1);
  });

  it("restoreSnapshot posts to the restore route", async () => {
    const spy = mockFetch(200, { items: 3, comments: 2, links: 1, warnings: [] });
    const result = await restoreSnapshot("import-snapshot-20260702T120000-000000Z.json");
    expect(result.items).toBe(3);
    expect(spy.mock.calls[0][0]).toBe(
      "/api/v1/import/snapshots/import-snapshot-20260702T120000-000000Z.json/restore",
    );
    expect(spy.mock.calls[0][1]?.method).toBe("POST");
  });

  it("throws on non-ok responses", async () => {
    mockFetch(404, "Item not found");
    await expect(updateItem(1, { version: 1 })).rejects.toThrow("Item not found");
  });

  it("surfaces the detail string from FastAPI error bodies", async () => {
    mockFetch(422, { detail: "Team is already linked to another product" });
    await expect(updateItem(1, { version: 1 })).rejects.toThrow(
      "Team is already linked to another product",
    );
  });

  it("getTeams fetches /api/v1/teams", async () => {
    const spy = mockFetch(200, [{ id: 1, name: "Network" }]);
    const teams = await getTeams();
    expect(spy).toHaveBeenCalledWith("/api/v1/teams", undefined);
    expect(teams[0].name).toBe("Network");
  });

  it("getBoards fetches /api/v1/boards", async () => {
    const spy = mockFetch(200, [{ id: 1, name: "Main", kinds: ["feature"], position: 0, lanes: [] }]);
    const boards = await getBoards();
    expect(spy).toHaveBeenCalledWith("/api/v1/boards", undefined);
    expect(boards[0].name).toBe("Main");
  });

  it("reorderLanes PUTs lane_ids", async () => {
    const spy = mockFetch(200, []);
    await reorderLanes(7, [3, 1, 2]);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/boards/7/lanes/order");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ lane_ids: [3, 1, 2] });
  });

  it("createLink posts the edge body", async () => {
    const spy = mockFetch(201, { id: 1, source_id: 2, target_id: 3, relation: "blocks" });
    await createLink({ source_id: 2, target_id: 3, relation: "blocks" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/links");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ source_id: 2, target_id: 3, relation: "blocks" });
  });

  it("deleteLink sends DELETE", async () => {
    const spy = mockFetch(204, "");
    await deleteLink(7);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/links/7");
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
    expect(url).toBe("/api/v1/planning-intervals");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "PI2-Q4" });
  });

  it("deletePlanningInterval sends DELETE", async () => {
    const spy = mockFetch(204, "");
    await deletePlanningInterval(5);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/planning-intervals/5");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("listItems auto-paginates until total", async () => {
    const page = (items: unknown[], total: number) =>
      ({ ok: true, status: 200, json: () => Promise.resolve({ items, total }) }) as Response;
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(page([{ id: 1 }, { id: 2 }], 3))
      .mockResolvedValueOnce(page([{ id: 3 }], 3));
    const out = await listItems();
    expect(out.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(spy).toHaveBeenNthCalledWith(1, "/api/v1/items?limit=500&offset=0", undefined);
    expect(spy).toHaveBeenNthCalledWith(2, "/api/v1/items?limit=500&offset=2", undefined);
  });

  it("updateItem sends the version in the body", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
    await updateItem(7, { status: "New", version: 3 });
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ status: "New", version: 3 });
  });

  it("getPersonOptions fetches /api/v1/users/options", async () => {
    const spy = mockFetch(200, [{ id: 1, display_name: "P" }]);
    const people = await getPersonOptions();
    expect(spy).toHaveBeenCalledWith("/api/v1/users/options", undefined);
    expect(people[0].display_name).toBe("P");
  });

  it("deleteUser hits DELETE", async () => {
    const spy = mockFetch(204, null);
    await deleteUser(7);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/users/7");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("getArts fetches /api/v1/arts", async () => {
    const spy = mockFetch(200, [{ id: 1, name: "ART1", description: null }]);
    const arts = await getArts();
    expect(spy).toHaveBeenCalledWith("/api/v1/arts", undefined);
    expect(arts[0].name).toBe("ART1");
  });

  it("createArt posts name + description", async () => {
    const spy = mockFetch(201, { id: 1, name: "ART1", description: "d" });
    await createArt("ART1", "d");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/arts");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "ART1", description: "d" });
  });

  it("createArt defaults description to null when omitted", async () => {
    const spy = mockFetch(201, { id: 1, name: "ART1", description: null });
    await createArt("ART1");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ name: "ART1", description: null });
  });

  it("updateArt PATCHes changes", async () => {
    const spy = mockFetch(200, { id: 1, name: "ART2", description: null });
    await updateArt(1, { name: "ART2" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/arts/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "ART2" });
  });

  it("deleteArt sends DELETE", async () => {
    const spy = mockFetch(204, null);
    await deleteArt(1);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/arts/1");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("getProducts GETs /api/v1/products", async () => {
    const spy = mockFetch(200, []);
    await getProducts();
    expect(spy).toHaveBeenCalledWith("/api/v1/products", undefined);
  });

  it("getProduct fetches by id", async () => {
    const spy = mockFetch(200, { id: 3, name: "P" });
    await getProduct(3);
    expect(spy).toHaveBeenCalledWith("/api/v1/products/3", undefined);
  });

  it("createProduct posts payload", async () => {
    const spy = mockFetch(201, { id: 1, name: "P", art_id: 2 });
    await createProduct({ name: "P", art_id: 2 });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/products");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "P", art_id: 2 });
  });

  it("updateProduct PATCHes changes", async () => {
    const spy = mockFetch(200, { id: 1, name: "P2" });
    await updateProduct(1, { name: "P2" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/products/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "P2" });
  });

  it("deleteProduct sends DELETE", async () => {
    const spy = mockFetch(204, null);
    await deleteProduct(1);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/products/1");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("getProductServices fetches the nested tree", async () => {
    const spy = mockFetch(200, []);
    await getProductServices(4);
    expect(spy).toHaveBeenCalledWith("/api/v1/products/4/services", undefined);
  });

  it("getServiceOptions GETs /api/v1/services", async () => {
    const spy = mockFetch(200, []);
    await getServiceOptions();
    expect(spy).toHaveBeenCalledWith("/api/v1/services", undefined);
  });

  it("createService POSTs payload", async () => {
    const spy = mockFetch(201, { id: 1 });
    await createService({ name: "S", product_id: 2 });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/services");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "S", product_id: 2 });
  });

  it("updateService PATCHes changes", async () => {
    const spy = mockFetch(200, { id: 1 });
    await updateService(1, { lifecycle_state: "active" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/services/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ lifecycle_state: "active" });
  });

  it("deleteService sends DELETE", async () => {
    const spy = mockFetch(204, null);
    await deleteService(1);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/services/1");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("getServiceDependencies fetches outbound/inbound", async () => {
    const spy = mockFetch(200, { outbound: [], inbound: [] });
    await getServiceDependencies(5);
    expect(spy).toHaveBeenCalledWith("/api/v1/services/5/dependencies", undefined);
  });

  it("addServiceDependency POSTs to nested route", async () => {
    const spy = mockFetch(201, { id: 1 });
    await addServiceDependency(5, { to_service_id: 6, dep_type: "requires", criticality: "critical" });
    expect(spy.mock.calls[0][0]).toBe("/api/v1/services/5/dependencies");
    expect(spy.mock.calls[0][1]?.method).toBe("POST");
  });

  it("removeServiceDependency DELETEs", async () => {
    const spy = mockFetch(204, null);
    await removeServiceDependency(5, 9);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/services/5/dependencies/9");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("getVendors GETs /api/v1/vendors", async () => {
    const spy = mockFetch(200, [{ id: 1, name: "Cisco", notes: null }]);
    const vendors = await getVendors();
    expect(spy).toHaveBeenCalledWith("/api/v1/vendors", undefined);
    expect(vendors[0].name).toBe("Cisco");
  });

  it("getProductComponents GETs nested route", async () => {
    const spy = mockFetch(200, []);
    await getProductComponents(4);
    expect(spy).toHaveBeenCalledWith("/api/v1/products/4/components", undefined);
  });

  it("getLifecycle GETs /api/v1/lifecycle", async () => {
    const spy = mockFetch(200, []);
    await getLifecycle();
    expect(spy).toHaveBeenCalledWith("/api/v1/lifecycle", undefined);
  });

  it("createComponent POSTs payload", async () => {
    const spy = mockFetch(201, { id: 1 });
    await createComponent({ name: "C", product_id: 2, vendor_name: "Cisco" });
    expect(spy.mock.calls[0][0]).toBe("/api/v1/components");
    expect(spy.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({
      name: "C",
      product_id: 2,
      vendor_name: "Cisco",
    });
  });

  it("updateComponent PATCHes changes", async () => {
    const spy = mockFetch(200, { id: 1, name: "C2" });
    await updateComponent(1, { lifecycle_stage: "operate" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/components/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ lifecycle_stage: "operate" });
  });

  it("deleteComponent sends DELETE", async () => {
    const spy = mockFetch(204, null);
    await deleteComponent(1);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/components/1");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("getProductSystems GETs nested route", async () => {
    const spy = mockFetch(200, []);
    await getProductSystems(4);
    expect(spy).toHaveBeenCalledWith("/api/v1/products/4/systems", undefined);
  });

  it("getSystems GETs the flat list", async () => {
    const spy = mockFetch(200, []);
    await getSystems();
    expect(spy).toHaveBeenCalledWith("/api/v1/systems", undefined);
  });

  it("createSystem POSTs payload", async () => {
    const spy = mockFetch(201, { id: 1, members: [] });
    await createSystem({ name: "S", product_id: 2 });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/systems");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "S", product_id: 2 });
  });

  it("updateSystem PATCHes changes", async () => {
    const spy = mockFetch(200, { id: 1, members: [] });
    await updateSystem(1, { lifecycle_stage: "build" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/systems/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ lifecycle_stage: "build" });
  });

  it("deleteSystem sends DELETE", async () => {
    const spy = mockFetch(204, null);
    await deleteSystem(1);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/systems/1");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("setSystemMember PUTs component + quantity", async () => {
    const spy = mockFetch(200, { id: 1, members: [] });
    await setSystemMember(3, 7, 40);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/systems/3/components");
    expect(spy.mock.calls[0][1]?.method).toBe("PUT");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ component_id: 7, quantity: 40 });
  });

  it("setSystemMember defaults quantity to null when omitted", async () => {
    const spy = mockFetch(200, { id: 1, members: [] });
    await setSystemMember(3, 7);
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ component_id: 7, quantity: null });
  });

  it("removeSystemMember DELETEs membership", async () => {
    const spy = mockFetch(200, { id: 1, members: [] });
    await removeSystemMember(3, 7);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/systems/3/components/7");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("getServiceTech GETs the tech route", async () => {
    const spy = mockFetch(200, { components: [], systems: [], risk: "ok" });
    await getServiceTech(5);
    expect(spy).toHaveBeenCalledWith("/api/v1/services/5/tech", undefined);
  });

  it("addServiceTechComponent POSTs to tech route", async () => {
    const spy = mockFetch(201, { components: [], systems: [], risk: "ok" });
    await addServiceTechComponent(5, 8);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/services/5/tech/components");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ component_id: 8 });
  });

  it("removeServiceTechComponent DELETEs", async () => {
    const spy = mockFetch(200, { components: [], systems: [], risk: "ok" });
    await removeServiceTechComponent(5, 8);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/services/5/tech/components/8");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("addServiceTechSystem POSTs to tech route", async () => {
    const spy = mockFetch(201, { components: [], systems: [], risk: "ok" });
    await addServiceTechSystem(5, 9);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/services/5/tech/systems");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ system_id: 9 });
  });

  it("removeServiceTechSystem DELETEs", async () => {
    const spy = mockFetch(200, { components: [], systems: [], risk: "ok" });
    await removeServiceTechSystem(5, 9);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/services/5/tech/systems/9");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });
});
