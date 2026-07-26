import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CatalogSystem, Component, Product } from "../types";
import ProductDetail from "./ProductDetail";

const comp: Component = {
  id: 1, name: "Catalyst 9300", model: "C9300-48P", description: null,
  product_id: 1, product_name: "Network", vendor_id: 1, vendor_name: "Cisco",
  lifecycle_stage: "operate", quantity: 120,
  eos_announced: null, end_of_sale: null,
  end_of_support: "2026-10-31", end_of_life: null, risk: "warning",
};

const comp2: Component = {
  id: 2, name: "Nexus 9k", model: "N9K-93180", description: null,
  product_id: 1, product_name: "Network", vendor_id: 1, vendor_name: "Cisco",
  lifecycle_stage: "operate", quantity: 40,
  eos_announced: null, end_of_sale: null,
  end_of_support: null, end_of_life: null, risk: "ok",
};

vi.mock("../api/client", () => ({
  getProductServices: vi.fn().mockResolvedValue([]),
  getProductComponents: vi.fn().mockResolvedValue([]),
  getProductSystems: vi.fn().mockResolvedValue([]),
  getVendors: vi.fn().mockResolvedValue([]),
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
}));

import {
  getProductComponents,
  getProductSystems,
  removeSystemMember,
  setSystemMember,
} from "../api/client";

const product: Product = {
  id: 1, name: "Network", description: null, art_id: 1, art_name: "ART",
  team_id: null, team_name: null, service_count: 0,
};

const system: CatalogSystem = {
  id: 9, name: "Campus fabric", description: null, product_id: 1, product_name: "Network",
  lifecycle_stage: "operate", risk: "danger",
  members: [{ component: comp, quantity: 80 }],
};

describe("ProductDetail Systems tab", () => {
  it("lists systems with member count and risk", async () => {
    vi.mocked(getProductSystems).mockResolvedValue([system]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Systems" }));
    expect(await screen.findByText("Campus fabric")).toBeInTheDocument();
    expect(screen.getByText("1 components")).toBeInTheDocument();
    expect(screen.getByText("danger")).toBeInTheDocument();
  });

  it("adds a member through the drawer", async () => {
    vi.mocked(getProductSystems).mockResolvedValue([system]);
    vi.mocked(getProductComponents).mockResolvedValue([comp, comp2]);
    vi.mocked(setSystemMember).mockResolvedValue(system);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Systems" }));
    await userEvent.click(await screen.findByText("Campus fabric"));
    await userEvent.click(await screen.findByRole("combobox", { name: "Add component member" }));
    await userEvent.click(screen.getByText("Nexus 9k"));
    expect(setSystemMember).toHaveBeenCalledWith(9, 2, null);
  });

  it("removes a member", async () => {
    vi.mocked(getProductSystems).mockResolvedValue([system]);
    vi.mocked(removeSystemMember).mockResolvedValue({ ...system, members: [] });
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Systems" }));
    await userEvent.click(await screen.findByText("Campus fabric"));
    await userEvent.click(await screen.findByRole("button", { name: "Remove Catalyst 9300" }));
    expect(removeSystemMember).toHaveBeenCalledWith(9, 1);
  });
});
