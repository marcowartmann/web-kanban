import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SupportContract } from "../types";
import ContractsView from "./ContractsView";

const rows: SupportContract[] = [
  { id: 1, name: "Dead", contract_no: null, product_id: 1,
    product_name: "Network", vendor_id: 1, vendor_name: "Cisco",
    start_date: null, end_date: "2020-01-01", yearly_cost: 15000,
    notice_period_days: null, notes: null, status: "expired", components: [] },
  { id: 2, name: "Evergreen", contract_no: null, product_id: 2,
    product_name: "Storage", vendor_id: null, vendor_name: null,
    start_date: null, end_date: null, yearly_cost: null,
    notice_period_days: null, notes: null, status: "active", components: [] },
];

vi.mock("../api/client", () => ({ getContracts: vi.fn() }));
import { getContracts } from "../api/client";

describe("ContractsView", () => {
  it("shows loading state while fetching", () => {
    vi.mocked(getContracts).mockReturnValue(new Promise(() => {}));
    render(<ContractsView />);
    expect(screen.getByRole("heading", { name: "Contracts" })).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(
      screen.queryByText("No contracts yet. Add them on a product's Contracts tab."),
    ).not.toBeInTheDocument();
  });

  it("renders the contract table", async () => {
    vi.mocked(getContracts).mockResolvedValue(rows);
    render(<ContractsView />);
    expect(await screen.findByText("Dead")).toBeInTheDocument();
    expect(screen.getByText("2020-01-01")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
    expect(screen.getByText("Evergreen")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("filters to expiring or expired only", async () => {
    vi.mocked(getContracts).mockResolvedValue(rows);
    render(<ContractsView />);
    await screen.findByText("Dead");
    await userEvent.click(screen.getByRole("button", { name: "Only expiring or expired" }));
    expect(screen.queryByText("Evergreen")).not.toBeInTheDocument();
    expect(screen.getByText("Dead")).toBeInTheDocument();
  });
});
