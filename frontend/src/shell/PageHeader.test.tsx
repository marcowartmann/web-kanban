import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import PageHeader from "./PageHeader";

it("renders title, subtitle, back link and actions", () => {
  render(
    <MemoryRouter>
      <PageHeader
        title="Products"
        subtitle="All ARTs"
        backTo={{ label: "Back to products", to: "/products" }}
        actions={<button>Add product</button>}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Products" })).toBeInTheDocument();
  expect(screen.getByText("All ARTs")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /back to products/i })).toHaveAttribute("href", "/products");
  expect(screen.getByRole("button", { name: "Add product" })).toBeInTheDocument();
});

it("renders without optional parts", () => {
  render(<PageHeader title="Planning" />);
  expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
});
