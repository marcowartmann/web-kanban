import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CatalogService, Product } from "../types";
import ProductDetail from "./ProductDetail";

const tree: CatalogService[] = [
  {
    id: 1, name: "Connectivity", description: null, product_id: 1,
    parent_service_id: null, owner_user_id: null, owner_name: null,
    lifecycle_state: "active",
    children: [
      { id: 2, name: "Campus LAN", description: null, product_id: 1,
        parent_service_id: 1, owner_user_id: null, owner_name: null,
        lifecycle_state: "planned", children: [] },
    ],
  },
];

vi.mock("../api/client", () => ({
  getProductServices: vi.fn().mockResolvedValue([]),
  getPersonOptions: vi.fn().mockResolvedValue([]),
  getServiceOptions: vi.fn().mockResolvedValue([]),
  getServiceDependencies: vi.fn().mockResolvedValue({ outbound: [], inbound: [] }),
  createService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
  addServiceDependency: vi.fn(),
  removeServiceDependency: vi.fn(),
}));

import { getProductServices } from "../api/client";

const product: Product = {
  id: 1, name: "Network", description: "core", art_id: 1, art_name: "Platform ART",
  team_id: null, team_name: null, service_count: 2,
};

describe("ProductDetail", () => {
  it("renders the service tree with lifecycle badges and expand/collapse", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    render(<ProductDetail product={product} onBack={() => {}} />);
    expect(await screen.findByText("Connectivity")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("Campus LAN")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /collapse connectivity/i }));
    expect(screen.queryByText("Campus LAN")).not.toBeInTheDocument();
  });

  it("opens the drawer when a service is clicked", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByText("Connectivity"));
    expect(await screen.findByRole("heading", { name: "Edit service" })).toBeInTheDocument();
  });

  it("shows the add-service form", async () => {
    vi.mocked(getProductServices).mockResolvedValue([]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /add service/i }));
    expect(screen.getByPlaceholderText("Service name")).toBeInTheDocument();
  });
});
