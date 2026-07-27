import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

vi.mock("../api/client", () => ({
  getContracts: vi.fn(),
  getLifecycle: vi.fn().mockResolvedValue([]),
  getVendors: vi.fn().mockResolvedValue([{ id: 1, name: "Cisco", notes: null }]),
  updateContract: vi.fn(),
}));
import { getContracts, updateContract } from "../api/client";

afterEach(() => vi.clearAllMocks());

describe("ContractsView", () => {
  it("shows loading state while fetching", () => {
    vi.mocked(getContracts).mockReturnValue(new Promise(() => {}));
    render(<ContractsView />);
    expect(screen.getByRole("heading", { name: "Contracts" })).toBeInTheDocument();
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
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

  it("shows an error banner when the fetch fails", async () => {
    vi.mocked(getContracts).mockRejectedValue(new Error("Network down"));
    render(<ContractsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
  });

  it("shows only the error banner when loading fails", async () => {
    vi.mocked(getContracts).mockRejectedValue(new Error("boom"));
    render(<ContractsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.queryByText(/no contracts yet/i)).not.toBeInTheDocument();
  });

  it("clicking a row opens the contract drawer for editing", async () => {
    vi.mocked(getContracts).mockResolvedValue(rows);
    render(<ContractsView />);
    await userEvent.click(await screen.findByRole("button", { name: "Dead" }));
    expect(await screen.findByRole("heading", { name: "Edit contract" })).toBeInTheDocument();
  });

  it("saving from the drawer refetches the list", async () => {
    vi.mocked(getContracts).mockResolvedValue(rows);
    vi.mocked(updateContract).mockResolvedValue(rows[0]);
    render(<ContractsView />);
    await userEvent.click(await screen.findByRole("button", { name: "Dead" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(getContracts).toHaveBeenCalledTimes(2));
  });
});
