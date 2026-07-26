import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Badge from "./Badge";

it("renders the tone's soft pill classes", () => {
  render(<Badge tone="emerald">active</Badge>);
  const el = screen.getByText("active");
  expect(el).toHaveClass("rounded-full", "bg-emerald-50", "text-emerald-700");
});

it("strike renders line-through gray text over any tone", () => {
  render(<Badge tone="blue" strike>cancelled</Badge>);
  const el = screen.getByText("cancelled");
  expect(el).toHaveClass("line-through", "text-gray-400");
  expect(el).not.toHaveClass("text-blue-700");
});
