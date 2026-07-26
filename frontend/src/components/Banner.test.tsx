import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Banner from "./Banner";

it("error tone renders a red banner with role alert", () => {
  render(<Banner tone="error">Save failed</Banner>);
  const el = screen.getByRole("alert");
  expect(el).toHaveTextContent("Save failed");
  expect(el).toHaveClass("bg-red-50", "text-red-700");
});

it("success and warning tones", () => {
  render(<Banner tone="success">Saved</Banner>);
  expect(screen.getByText("Saved")).toHaveClass("bg-emerald-50");
});
