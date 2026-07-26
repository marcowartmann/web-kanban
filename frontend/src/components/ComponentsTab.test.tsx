import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Component, Product } from "../types";
import ProductDetail from "./ProductDetail";

const comp: Component = {
  id: 1, name: "Catalyst 9300", model: "C9300-48P", description: null,
  product_id: 1, product_name: "Network", vendor_id: 1, vendor_name: "Cisco",
  lifecycle_stage: "operate", quantity: 120,
  eos_announced: null, end_of_sale: null,
  end_of_support: "2026-10-31", end_of_life: null, risk: "warning",
};

vi.mock("../api/client", () => ({
  getProductServices: vi.fn().mockResolvedValue([]),
  getProductComponents: vi.fn().mockResolvedValue([]),
  getProductSystems: vi.fn().mockResolvedValue([]),
  getVendors: vi.fn().mockResolvedValue([{ id: 1, name: "Cisco", notes: null }]),
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

import { createComponent, getProductComponents } from "../api/client";

const product: Product = {
  id: 1, name: "Network", description: null, art_id: 1, art_name: "ART",
  team_id: null, team_name: null, service_count: 0,
};

describe("ProductDetail Components tab", () => {
  it("lists components with vendor, stage, and risk badge", async () => {
    vi.mocked(getProductComponents).mockResolvedValue([comp]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Components" }));
    expect(await screen.findByText("Catalyst 9300")).toBeInTheDocument();
    expect(screen.getByText("Cisco")).toBeInTheDocument();
    expect(screen.getByText("operate")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
  });

  it("creates a component through the drawer", async () => {
    vi.mocked(getProductComponents).mockResolvedValue([]);
    vi.mocked(createComponent).mockResolvedValue(comp);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Components" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add component" }));
    await userEvent.type(screen.getByLabelText("Component name"), "New Switch");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(vi.mocked(createComponent).mock.calls[0][0]).toMatchObject({
      name: "New Switch", product_id: 1,
    });
  });

  it("opens edit mode with existing values", async () => {
    vi.mocked(getProductComponents).mockResolvedValue([comp]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Components" }));
    await userEvent.click(await screen.findByText("Catalyst 9300"));
    expect(await screen.findByDisplayValue("Catalyst 9300")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-10-31")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Vendor" })).toHaveValue("Cisco");
  });

  it("creates a component with a new vendor via the picker's on-the-fly create", async () => {
    vi.mocked(getProductComponents).mockResolvedValue([]);
    vi.mocked(createComponent).mockResolvedValue(comp);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Components" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add component" }));
    await userEvent.type(screen.getByLabelText("Component name"), "New Switch");
    const vendorInput = await screen.findByRole("combobox", { name: "Vendor" });
    await userEvent.type(vendorInput, "NewVendor");
    await userEvent.click(await screen.findByText('Use “NewVendor”'));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(vi.mocked(createComponent).mock.calls.at(-1)?.[0]).toMatchObject({
      name: "New Switch", product_id: 1, vendor_name: "NewVendor",
    });
  });
});
