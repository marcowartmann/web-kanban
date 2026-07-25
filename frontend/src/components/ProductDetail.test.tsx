import { render, screen, waitFor } from "@testing-library/react";
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

import {
  createService,
  getProductServices,
  getServiceDependencies,
  removeServiceDependency,
  updateService,
} from "../api/client";

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

  it("resets drawer state when switching to a different service", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByText("Connectivity"));
    expect(await screen.findByDisplayValue("Connectivity")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Campus LAN"));
    expect(await screen.findByDisplayValue("Campus LAN")).toBeInTheDocument();
    // "Connectivity" may appear exactly once — as Campus LAN's parent select
    // value. A stale NAME field would produce a second match.
    const conn = screen.queryAllByDisplayValue("Connectivity");
    expect(conn).toHaveLength(1);
    expect(conn[0]).toHaveAccessibleName("Parent service");
  });

  it("omits owner_user_id from the save payload when the owner field wasn't touched", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    vi.mocked(getServiceDependencies).mockResolvedValue({ outbound: [], inbound: [] });
    vi.mocked(updateService).mockResolvedValue(tree[0]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByText("Connectivity"));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateService).toHaveBeenCalled());
    expect(vi.mocked(updateService).mock.calls[0][1]).not.toHaveProperty("owner_user_id");
  });

  it("surfaces an error in the drawer when removing a dependency fails", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    vi.mocked(getServiceDependencies).mockResolvedValue({
      outbound: [
        {
          id: 10,
          from_service_id: 1,
          to_service_id: 2,
          from_service_name: "Connectivity",
          to_service_name: "Campus LAN",
          from_product_name: "Network",
          to_product_name: "Network",
          dep_type: "requires",
          criticality: "important",
          note: null,
        },
      ],
      inbound: [],
    });
    vi.mocked(removeServiceDependency).mockRejectedValue(new Error("dependency in use"));
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByText("Connectivity"));
    await userEvent.click(
      await screen.findByRole("button", { name: /remove dependency on campus lan/i }),
    );
    expect(await screen.findByText("dependency in use")).toBeInTheDocument();
  });

  it("keeps the add-service form open and shows an error when creation fails", async () => {
    vi.mocked(getProductServices).mockResolvedValue([]);
    vi.mocked(createService).mockRejectedValue(new Error("name already exists"));
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /add service/i }));
    await userEvent.type(screen.getByPlaceholderText("Service name"), "Dup");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("name already exists")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Service name")).toBeInTheDocument();
  });


  it("creates a sub-service under a node", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    vi.mocked(createService).mockResolvedValue(tree[0]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Add sub-service to Connectivity" }),
    );
    await userEvent.type(screen.getByPlaceholderText("Service name"), "Edge");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(createService).toHaveBeenCalledWith({
      name: "Edge",
      product_id: 1,
      parent_service_id: 1,
    });
  });

  it("shows the current parent in the drawer", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByText("Campus LAN"));
    expect(await screen.findByRole("combobox", { name: "Parent service" })).toHaveValue(
      "Connectivity",
    );
  });

  it("clearing the parent saves parent_service_id null", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    vi.mocked(updateService).mockResolvedValue(tree[0]);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByText("Campus LAN"));
    await userEvent.click(await screen.findByRole("button", { name: "Clear Parent service" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(vi.mocked(updateService).mock.calls.at(-1)?.[1]).toMatchObject({
        parent_service_id: null,
      }),
    );
  });

  it("excludes self and descendants from parent options", async () => {
    vi.mocked(getProductServices).mockResolvedValue(tree);
    render(<ProductDetail product={product} onBack={() => {}} />);
    await userEvent.click(await screen.findByText("Connectivity"));
    await userEvent.click(await screen.findByRole("combobox", { name: "Parent service" }));
    expect(await screen.findByText("No matches")).toBeInTheDocument();
  });

});
