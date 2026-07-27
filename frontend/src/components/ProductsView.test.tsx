import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import ProductsView from "./ProductsView";

vi.mock("../api/client", () => ({
  getProducts: vi.fn().mockResolvedValue([
    { id: 1, name: "Network", description: "core", art_id: 1, art_name: "Platform ART",
      team_id: null, team_name: null, service_count: 3 },
    { id: 2, name: "Storage", description: null, art_id: 2, art_name: "Infra ART",
      team_id: 5, team_name: "Storage Team", service_count: 0 },
  ]),
  getProductServices: vi.fn().mockResolvedValue([]),
  getPersonOptions: vi.fn().mockResolvedValue([]),
  getServiceOptions: vi.fn().mockResolvedValue([]),
}));

import * as client from "../api/client";
import { getProducts } from "../api/client";

describe("ProductsView", () => {
  it("groups products by ART with service counts", async () => {
    render(
      <MemoryRouter>
        <ProductsView />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Products" })).toBeInTheDocument();
    expect(await screen.findByText("Platform ART")).toBeInTheDocument();
    expect(screen.getByText("Infra ART")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("3 services")).toBeInTheDocument();
    expect(screen.getByText("Team: Storage Team")).toBeInTheDocument();
  });

  it("sorts ART groups alphabetically with No ART last", async () => {
    vi.mocked(getProducts).mockResolvedValueOnce([
      { id: 3, name: "Zed", description: null, art_id: 9, art_name: "Zulu ART",
        team_id: null, team_name: null, service_count: 0 },
      { id: 4, name: "Orphan", description: null, art_id: 0, art_name: null,
        team_id: null, team_name: null, service_count: 0 },
      { id: 5, name: "Alpha", description: null, art_id: 8, art_name: "Alpha ART",
        team_id: null, team_name: null, service_count: 0 },
    ]);
    render(
      <MemoryRouter>
        <ProductsView />
      </MemoryRouter>,
    );
    await screen.findByText("Zed");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Alpha ART", "Zulu ART", "No ART"]);
  });

  it("clicking a product card navigates to its detail route", async () => {
    vi.spyOn(client, "getProducts").mockResolvedValue([
      { id: 7, name: "Network", description: null, art_id: 1, art_name: "DP", team_id: 1, team_name: "Network", service_count: 2 },
    ] as never);
    render(
      <MemoryRouter initialEntries={["/products"]}>
        <Routes>
          <Route path="/products" element={<ProductsView />} />
          <Route path="/products/:productId" element={<div>DETAIL PROBE</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByText("Network"));
    expect(await screen.findByText("DETAIL PROBE")).toBeInTheDocument();
  });

  it("shows skeleton cards while products load", () => {
    vi.spyOn(client, "getProducts").mockReturnValue(new Promise(() => {}));
    render(
      <MemoryRouter>
        <ProductsView />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });
});
