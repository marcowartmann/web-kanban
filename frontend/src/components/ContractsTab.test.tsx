import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Component, Product, SupportContract } from "../types";
import ProductDetail from "./ProductDetail";

const comp: Component = {
  id: 1, name: "Catalyst 9300", model: "C9300-48P", description: null,
  product_id: 1, product_name: "Network", vendor_id: 1, vendor_name: "Cisco",
  lifecycle_stage: "operate", quantity: 120,
  eos_announced: null, end_of_sale: null,
  end_of_support: "2026-10-31", end_of_life: null,
  yearly_run_cost: null, replacement_budget: null, risk: "warning", contracts: [],
};

const contract: SupportContract = {
  id: 7, name: "SmartNet", contract_no: null, product_id: 1, product_name: "Network",
  vendor_id: 1, vendor_name: "Cisco", start_date: null, end_date: "2026-08-15",
  yearly_cost: 15000, notice_period_days: null, notes: null,
  status: "expiring", components: [],
};

vi.mock("../api/client", () => ({
  getProductServices: vi.fn().mockResolvedValue([]),
  getProductComponents: vi.fn().mockResolvedValue([]),
  getProductSystems: vi.fn().mockResolvedValue([]),
  getProductContracts: vi.fn().mockResolvedValue([]),
  getContracts: vi.fn().mockResolvedValue([]),
  getVendors: vi.fn().mockResolvedValue([{ id: 1, name: "Cisco", notes: null }]),
  getLifecycle: vi.fn().mockResolvedValue([]),
  getPersonOptions: vi.fn().mockResolvedValue([]),
  getServiceOptions: vi.fn().mockResolvedValue([]),
  getServiceDependencies: vi.fn().mockResolvedValue({ outbound: [], inbound: [] }),
  getServiceTech: vi.fn().mockResolvedValue({ components: [], systems: [], risk: "ok" }),
  createService: vi.fn(), updateService: vi.fn(), deleteService: vi.fn(),
  addServiceDependency: vi.fn(), removeServiceDependency: vi.fn(),
  createComponent: vi.fn(), updateComponent: vi.fn(), deleteComponent: vi.fn(),
  createSystem: vi.fn(), updateSystem: vi.fn(), deleteSystem: vi.fn(),
  setSystemMember: vi.fn(), removeSystemMember: vi.fn(),
  addServiceTechComponent: vi.fn(), removeServiceTechComponent: vi.fn(),
  addServiceTechSystem: vi.fn(), removeServiceTechSystem: vi.fn(),
  createContract: vi.fn(), updateContract: vi.fn(), deleteContract: vi.fn(),
  linkContractComponent: vi.fn(), unlinkContractComponent: vi.fn(),
}));

import {
  createContract,
  getLifecycle,
  getProductComponents,
  getProductContracts,
  linkContractComponent,
} from "../api/client";

const product: Product = {
  id: 1, name: "Network", description: null, art_id: 1, art_name: "ART",
  team_id: null, team_name: null, service_count: 0,
};

describe("ProductDetail Contracts tab", () => {
  it("lists contracts with status badge and totals", async () => {
    vi.mocked(getProductContracts).mockResolvedValue([contract]);
    vi.mocked(getProductComponents).mockResolvedValue([
      { ...comp, yearly_run_cost: 1200, replacement_budget: 90000 },
    ]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Contracts" }));
    expect(await screen.findByText("SmartNet")).toBeInTheDocument();
    expect(screen.getByText("expiring")).toBeInTheDocument();
    expect(screen.getAllByText(/15’000|15,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1’200|1,200/)).toBeInTheDocument();
  });

  it("creates a contract through the drawer", async () => {
    vi.mocked(getProductContracts).mockResolvedValue([]);
    vi.mocked(createContract).mockResolvedValue(contract);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Contracts" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add contract" }));
    await userEvent.type(screen.getByLabelText("Contract name"), "SmartNet");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(vi.mocked(createContract).mock.calls[0][0]).toMatchObject({
      name: "SmartNet", product_id: 1,
    });
  });

  it("links a component from the drawer", async () => {
    vi.mocked(getProductContracts).mockResolvedValue([contract]);
    vi.mocked(getLifecycle).mockResolvedValue([comp]);
    vi.mocked(linkContractComponent).mockResolvedValue({
      ...contract,
      components: [{ id: comp.id, name: comp.name, product_name: "Network" }],
    });
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Contracts" }));
    await userEvent.click(await screen.findByText("SmartNet"));
    await userEvent.click(await screen.findByRole("combobox", { name: "Link component" }));
    await userEvent.click(screen.getByText("Catalyst 9300 (Network)"));
    expect(linkContractComponent).toHaveBeenCalledWith(7, 1);
  });
});
