import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import AuditLogSection from "./AuditLogSection";

afterEach(() => vi.restoreAllMocks());

const ev = (id: number, over: object = {}) => ({
  id, created_at: "2026-07-02T10:00:00", actor_name: "Marco",
  event_type: "item.updated", entity_type: "item", entity_id: 5,
  entity_label: "Feature X", field: "status", old_value: "Funnel", new_value: "Ready",
  ...over,
});

it("renders rows and loads more", async () => {
  const spy = vi
    .spyOn(client, "getAuditEvents")
    .mockResolvedValueOnce({ items: [ev(2), ev(1, { entity_id: 6 })], total: 3 } as never)
    .mockResolvedValueOnce({ items: [ev(3, { actor_name: "Anna" })], total: 3 } as never);
  render(<AuditLogSection />);
  expect(await screen.findByText("Feature X #5")).toBeInTheDocument();
  expect(screen.getAllByText(/status: Funnel → Ready/).length).toBe(2);

  await userEvent.click(screen.getByRole("button", { name: /load more/i }));
  expect(await screen.findByText("Anna")).toBeInTheDocument();
  expect(spy).toHaveBeenLastCalledWith({ limit: 50, offset: 2, q: "", entity_type: "" });
  expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument(); // 3 of 3 loaded
});

it("filters reset the offset and refetch", async () => {
  const spy = vi
    .spyOn(client, "getAuditEvents")
    .mockResolvedValue({ items: [ev(1, { entity_type: "auth", event_type: "auth.login", field: null })], total: 1 } as never);
  render(<AuditLogSection />);
  await screen.findByText(/auth.login/);
  await userEvent.selectOptions(screen.getByLabelText(/entity type/i), "auth");
  expect(spy).toHaveBeenLastCalledWith({ limit: 50, offset: 0, q: "", entity_type: "auth" });
  await userEvent.type(screen.getByPlaceholderText(/filter by actor/i), "m");
  expect(spy).toHaveBeenLastCalledWith({ limit: 50, offset: 0, q: "m", entity_type: "auth" });
});

it("shows the empty state", async () => {
  vi.spyOn(client, "getAuditEvents").mockResolvedValue({ items: [], total: 0 } as never);
  render(<AuditLogSection />);
  expect(await screen.findByText("No audit events.")).toBeInTheDocument();
});
