import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import UtilizationMeter from "./UtilizationMeter";

it("shows load / cap and an emerald fill when under capacity", () => {
  const { container } = render(<UtilizationMeter load={3} capacity={5} />);
  expect(screen.getByText("3 / 5")).toBeInTheDocument();
  expect(container.querySelector(".bg-emerald-500")).toBeTruthy();
});

it("uses amber at exactly capacity", () => {
  const { container } = render(<UtilizationMeter load={5} capacity={5} />);
  expect(container.querySelector(".bg-amber-500")).toBeTruthy();
  expect(container.querySelector(".bg-red-500")).toBeFalsy();
});

it("uses red when over capacity", () => {
  const { container } = render(<UtilizationMeter load={7} capacity={5} />);
  expect(container.querySelector(".bg-red-500")).toBeTruthy();
});

it("renders a muted dash when empty (no capacity, no load) and no bar", () => {
  const { container } = render(<UtilizationMeter load={0} capacity={0} />);
  expect(screen.getByText("—")).toBeInTheDocument();
  expect(container.querySelector(".bg-emerald-500")).toBeFalsy();
});

it("is red when load exists with zero capacity", () => {
  const { container } = render(<UtilizationMeter load={2} capacity={0} />);
  expect(container.querySelector(".bg-red-500")).toBeTruthy();
});
