import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Component } from "../types";
import LifecycleView from "./LifecycleView";

const rows: Component[] = [
  { id: 1, name: "Dead", model: null, description: null, product_id: 1,
    product_name: "Network", vendor_id: 1, vendor_name: "Cisco",
    lifecycle_stage: "operate", quantity: null, eos_announced: null,
    end_of_sale: null, end_of_support: null, end_of_life: "2020-01-01",
    yearly_run_cost: null, replacement_budget: null, risk: "danger", contracts: [] },
  { id: 2, name: "Fine", model: "X", description: null, product_id: 2,
    product_name: "Storage", vendor_id: null, vendor_name: null,
    lifecycle_stage: "plan", quantity: null, eos_announced: null,
    end_of_sale: null, end_of_support: null, end_of_life: null,
    yearly_run_cost: null, replacement_budget: null, risk: "ok", contracts: [] },
];

vi.mock("../api/client", () => ({ getLifecycle: vi.fn() }));
import { getLifecycle } from "../api/client";

describe("LifecycleView", () => {
  it("shows loading state while fetching", () => {
    vi.mocked(getLifecycle).mockReturnValue(new Promise(() => {}));
    render(<LifecycleView />);
    expect(screen.getByRole("heading", { name: "Lifecycle" })).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("No components yet")).not.toBeInTheDocument();
  });

  it("renders the component table", async () => {
    vi.mocked(getLifecycle).mockResolvedValue(rows);
    render(<LifecycleView />);
    expect(await screen.findByText("Dead")).toBeInTheDocument();
    expect(screen.getByText("2020-01-01")).toBeInTheDocument();
    expect(screen.getByText("danger")).toBeInTheDocument();
    expect(screen.getByText("Fine")).toBeInTheDocument();
  });

  it("filters to at-risk only", async () => {
    vi.mocked(getLifecycle).mockResolvedValue(rows);
    render(<LifecycleView />);
    await screen.findByText("Dead");
    await userEvent.click(screen.getByRole("button", { name: "Only at risk" }));
    expect(screen.queryByText("Fine")).not.toBeInTheDocument();
    expect(screen.getByText("Dead")).toBeInTheDocument();
  });
});
