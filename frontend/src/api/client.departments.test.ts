import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDepartment,
  getDepartments,
  setDepartmentMembers,
  setUserDepartments,
} from "./client";

function mockFetch(status: number, body: unknown) {
  const nullBody = new Set([204, 205, 304]);
  const spy = vi.fn().mockResolvedValue(
    new Response(nullBody.has(status) ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("departments client", () => {
  it("getDepartments hits the right URL", async () => {
    const spy = mockFetch(200, []);
    await getDepartments();
    expect(spy.mock.calls[0][0]).toBe("/api/v1/departments");
  });

  it("createDepartment posts name + team_id", async () => {
    const spy = mockFetch(201, { id: 1, name: "FE", team_id: 2, team_name: "Net", member_ids: [] });
    await createDepartment("FE", 2);
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ name: "FE", team_id: 2 });
  });

  it("setDepartmentMembers PUTs user_ids", async () => {
    const spy = mockFetch(200, { id: 1, name: "FE", team_id: 2, team_name: "Net", member_ids: [7] });
    await setDepartmentMembers(1, [7]);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/departments/1/members");
    expect(spy.mock.calls[0][1]?.method).toBe("PUT");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ user_ids: [7] });
  });

  it("setUserDepartments PUTs department_ids", async () => {
    const spy = mockFetch(200, { id: 7, email: null, display_name: "U", role: "member", is_active: true });
    await setUserDepartments(7, [1, 2]);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/users/7/departments");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({ department_ids: [1, 2] });
  });
});
