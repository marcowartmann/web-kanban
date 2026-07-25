import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CatalogSection from "./CatalogSection";

vi.mock("../../api/client", () => ({
  getArts: vi.fn().mockResolvedValue([{ id: 1, name: "Platform ART", description: null }]),
  getProducts: vi.fn().mockResolvedValue([
    { id: 1, name: "Network", description: null, art_id: 1, art_name: "Platform ART",
      team_id: null, team_name: null, service_count: 0 },
  ]),
  getTeams: vi.fn().mockResolvedValue([{ id: 1, name: "Net Team" }]),
  createArt: vi.fn().mockResolvedValue({ id: 2, name: "New ART", description: null }),
  updateArt: vi.fn(),
  deleteArt: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

import { createArt, createProduct, deleteProduct, getArts, updateArt, updateProduct } from "../../api/client";

describe("CatalogSection", () => {
  it("lists ARTs and products", async () => {
    render(<CatalogSection />);
    // "Platform ART" renders twice by design: once in the ARTs list, once as
    // the selected value inside the product's ART PlainSelect trigger.
    expect((await screen.findAllByText("Platform ART")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Network")).toBeInTheDocument();
  });

  it("creates an ART", async () => {
    render(<CatalogSection />);
    await screen.findByText("Network");
    await userEvent.type(screen.getByPlaceholderText("New ART name"), "New ART");
    await userEvent.click(screen.getByRole("button", { name: "Add ART" }));
    expect(createArt).toHaveBeenCalledWith("New ART");
  });

  it("shows an error strip when the initial load fails", async () => {
    vi.mocked(getArts).mockRejectedValueOnce(new Error("Network down"));
    render(<CatalogSection />);
    expect(await screen.findByText("Network down")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting a product", async () => {
    render(<CatalogSection />);
    await userEvent.click(await screen.findByRole("button", { name: /delete network/i }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteProduct).toHaveBeenCalledWith(1);
  });


  it("renames an ART inline", async () => {
    render(<CatalogSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Rename Platform ART" }));
    const input = screen.getByRole("textbox", { name: "Rename Platform ART" });
    await userEvent.clear(input);
    await userEvent.type(input, "P-ART{Enter}");
    expect(updateArt).toHaveBeenCalledWith(1, { name: "P-ART" });
  });

  it("renames a product inline", async () => {
    render(<CatalogSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Rename Network" }));
    const input = screen.getByRole("textbox", { name: "Rename Network" });
    await userEvent.clear(input);
    await userEvent.type(input, "Net{Enter}");
    expect(updateProduct).toHaveBeenCalledWith(1, { name: "Net" });
  });

  it("keeps the typed product name when no ART is selected", async () => {
    render(<CatalogSection />);
    await screen.findByText("Network");
    await userEvent.type(screen.getByPlaceholderText("New product name"), "Storage");
    await userEvent.click(screen.getByRole("button", { name: "Add product" }));
    expect(await screen.findByText("Select an ART for the new product")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("New product name")).toHaveValue("Storage");
    expect(createProduct).not.toHaveBeenCalled();
  });

});
