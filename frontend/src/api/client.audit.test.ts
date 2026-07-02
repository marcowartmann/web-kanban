import { afterEach, expect, it, vi } from "vitest";
import { getAuditEvents, getItemEvents } from "./client";

function mockFetch(status: number, body: unknown) {
  const nullBodyStatuses = new Set([204, 205, 304]);
  const spy = vi.fn().mockResolvedValue(
    new Response(nullBodyStatuses.has(status) ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

it("getItemEvents fetches the item's events", async () => {
  const spy = mockFetch(200, []);
  await getItemEvents(7);
  expect(spy.mock.calls[0][0]).toBe("/api/items/7/events");
});

it("getAuditEvents builds the query string and skips empty params", async () => {
  const spy = mockFetch(200, { items: [], total: 0 });
  await getAuditEvents({ limit: 50, offset: 100, q: "marco", entity_type: "auth" });
  expect(spy.mock.calls[0][0]).toBe("/api/audit?limit=50&offset=100&q=marco&entity_type=auth");

  const spy2 = mockFetch(200, { items: [], total: 0 });
  await getAuditEvents({});
  expect(spy2.mock.calls[0][0]).toBe("/api/audit");
});
