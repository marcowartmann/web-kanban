import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ItemActivity from "./ItemActivity";

afterEach(() => vi.restoreAllMocks());

const ev = (over: object) => ({
  id: 1, created_at: "2026-07-02T10:00:00", actor_name: "Marco",
  event_type: "item.updated", entity_type: "item", entity_id: 5,
  entity_label: "F", field: "status", old_value: "Funnel", new_value: "Ready",
  ...over,
});

it("renders created, updated, and link events", async () => {
  vi.spyOn(client, "getItemEvents").mockResolvedValue([
    ev({ id: 3, event_type: "link.added", field: "link", old_value: null, new_value: "blocks → #9 Other" }),
    ev({ id: 2 }),
    ev({ id: 1, event_type: "item.created", field: null, old_value: null, new_value: null }),
  ] as never);
  render(<ItemActivity itemId={5} />);
  expect(await screen.findByText(/added link blocks → #9 Other/)).toBeInTheDocument();
  expect(screen.getByText(/changed status: Funnel → Ready/)).toBeInTheDocument();
  expect(screen.getByText(/created this item/)).toBeInTheDocument();
  expect(screen.getAllByText(/Marco/).length).toBeGreaterThan(0);
});

it("shows the empty state and survives fetch errors", async () => {
  vi.spyOn(client, "getItemEvents").mockRejectedValue(new Error("401"));
  render(<ItemActivity itemId={5} />);
  expect(await screen.findByText("No activity yet.")).toBeInTheDocument();
});
