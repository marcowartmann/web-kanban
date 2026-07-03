import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeMyPassword,
  createUser,
  getMe,
  listUsers,
  login,
  logout,
  setUnauthorizedHandler,
  updateUser,
} from "./client";

function mockFetch(status: number, body: unknown) {
  // Statuses in this set are "null body" statuses per the Fetch spec: the
  // Response constructor throws if given a non-null body (even "") for them.
  const nullBodyStatuses = new Set([204, 205, 304]);
  const spy = vi.fn().mockResolvedValue(
    new Response(
      nullBodyStatuses.has(status) ? null : typeof body === "string" ? body : JSON.stringify(body),
      { status },
    ),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe("auth client", () => {
  it("login posts credentials", async () => {
    const spy = mockFetch(200, { id: 1, email: "a@b.ch", display_name: "A", role: "admin", is_active: true });
    const user = await login("jdoe", "pw123456", "ldap");
    expect(user.role).toBe("admin");
    expect(spy.mock.calls[0][0]).toBe("/api/v1/auth/login");
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({
      username: "jdoe",
      password: "pw123456",
      method: "ldap",
    });
  });

  it("login 401 does NOT trigger the unauthorized handler", async () => {
    mockFetch(401, "Invalid credentials");
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(login("jdoe", "bad", "local")).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("a 401 on a normal call triggers the unauthorized handler", async () => {
    mockFetch(401, "Not authenticated");
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(listUsers()).rejects.toThrow();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("a 401 from changeMyPassword does NOT trigger the unauthorized handler", async () => {
    mockFetch(401, "Current password is incorrect");
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(changeMyPassword("wrong", "newpass123")).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("logout, me, password, users hit the right URLs", async () => {
    const spy = mockFetch(204, "");
    await logout();
    expect(spy.mock.calls[0][0]).toBe("/api/v1/auth/logout");
    expect(spy.mock.calls[0][1]?.method).toBe("POST");

    mockFetch(200, { id: 1, email: "a@b.ch", display_name: "A", role: "member", is_active: true });
    expect((await getMe()).id).toBe(1);

    const pw = mockFetch(204, "");
    await changeMyPassword("old12345", "new12345");
    expect(pw.mock.calls[0][0]).toBe("/api/v1/auth/me/password");
    expect(pw.mock.calls[0][1]?.method).toBe("PATCH");

    const cu = mockFetch(201, { id: 2, email: "x@x.ch", display_name: "X", role: "member", is_active: true });
    await createUser({ email: "x@x.ch", username: "x", display_name: "X", password: "pw123456", role: "member" });
    expect(cu.mock.calls[0][0]).toBe("/api/v1/users");

    const uu = mockFetch(200, { id: 2, email: "x@x.ch", display_name: "X", role: "admin", is_active: true });
    await updateUser(2, { role: "admin" });
    expect(uu.mock.calls[0][0]).toBe("/api/v1/users/2");
    expect(uu.mock.calls[0][1]?.method).toBe("PATCH");
  });
});
