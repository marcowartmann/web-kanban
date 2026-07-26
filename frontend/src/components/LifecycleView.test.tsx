import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

vi.mock("../api/client", () => ({
  getLifecycle: vi.fn(),
  getVendors: vi.fn().mockResolvedValue([{ id: 1, name: "Cisco", notes: null }]),
  updateComponent: vi.fn(),
}));
import { getLifecycle, updateComponent } from "../api/client";

afterEach(() => vi.clearAllMocks());

describe("LifecycleView", () => {
  it("shows loading state while fetching", () => {
    vi.mocked(getLifecycle).mockReturnValue(new Promise(() => {}));
    render(<LifecycleView />);
    expect(screen.getByRole("heading", { name: "Lifecycle" })).toBeInTheDocument();
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
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

  it("shows an error banner when the fetch fails", async () => {
    vi.mocked(getLifecycle).mockRejectedValue(new Error("Network down"));
    render(<LifecycleView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
  });

  it("clicking a row opens the component drawer for editing", async () => {
    vi.mocked(getLifecycle).mockResolvedValue(rows);
    render(<LifecycleView />);
    await userEvent.click(await screen.findByRole("button", { name: "Dead" }));
    expect(await screen.findByRole("heading", { name: "Edit component" })).toBeInTheDocument();
  });

  it("saving from the drawer refetches the list", async () => {
    vi.mocked(getLifecycle).mockResolvedValue(rows);
    vi.mocked(updateComponent).mockResolvedValue(rows[0]);
    render(<LifecycleView />);
    await userEvent.click(await screen.findByRole("button", { name: "Dead" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(getLifecycle).toHaveBeenCalledTimes(2));
  });
});
