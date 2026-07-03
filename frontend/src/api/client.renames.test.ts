import { afterEach, expect, it, vi } from "vitest";
import {
  ConflictError,
  deleteTeam,
  renamePlanningInterval,
  renameTeam,
} from "./client";

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;

afterEach(() => vi.restoreAllMocks());

it("rename fns PATCH the right URLs", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: 1 }));
  await renameTeam(1, "Net");
  await renamePlanningInterval(3, "PI2");
  expect(spy).toHaveBeenNthCalledWith(1, "/api/v1/teams/1", expect.objectContaining({ method: "PATCH" }));
  expect(spy).toHaveBeenNthCalledWith(2, "/api/v1/planning-intervals/3", expect.objectContaining({ method: "PATCH" }));
});

it("delete fns append force=true only when forced", async () => {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: true, status: 204 } as Response);
  await deleteTeam(7);
  await deleteTeam(7, true);
  expect(spy).toHaveBeenNthCalledWith(1, "/api/v1/teams/7", expect.anything());
  expect(spy).toHaveBeenNthCalledWith(2, "/api/v1/teams/7?force=true", expect.anything());
});

it("409 responses throw ConflictError with the parsed detail", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status: 409,
    statusText: "Conflict",
    text: () => Promise.resolve('{"detail":"Team \'X\' is referenced by 3 items"}'),
  } as Response);
  const err = await deleteTeam(1).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ConflictError);
  expect((err as ConflictError).detail).toBe("Team 'X' is referenced by 3 items");
});

it("non-409 errors keep the generic Error shape", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status: 404,
    statusText: "Not Found",
    text: () => Promise.resolve('{"detail":"Team not found"}'),
  } as Response);
  const err = await renameTeam(9, "Z").catch((e: unknown) => e);
  expect(err).not.toBeInstanceOf(ConflictError);
  expect((err as Error).message).toContain("404 Not Found");
});
