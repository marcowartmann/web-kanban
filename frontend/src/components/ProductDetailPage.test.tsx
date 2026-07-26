import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ProductDetailPage from "./ProductDetailPage";

afterEach(() => vi.restoreAllMocks());

const NETWORK = {
  id: 7, name: "Network", description: null,
  art_id: 1, art_name: "DP", team_id: 1, team_name: "Network", service_count: 2,
} as never;

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/products/:productId" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

it("loads the product from the route param and renders its detail", async () => {
  vi.spyOn(client, "getProduct").mockResolvedValue(NETWORK);
  vi.spyOn(client, "getProductServices").mockResolvedValue([] as never);
  renderAt("/products/7");
  expect(await screen.findByRole("heading", { name: "Network" })).toBeInTheDocument();
  expect(client.getProduct).toHaveBeenCalledWith(7);
});

it("unknown product ids show an error with a way back", async () => {
  vi.spyOn(client, "getProduct").mockRejectedValue(new Error("Not found"));
  renderAt("/products/999");
  expect(await screen.findByText("Product not found.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /back to products/i })).toBeInTheDocument();
});
