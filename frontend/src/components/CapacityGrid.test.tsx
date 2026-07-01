import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { MemberCapacityRow } from "../lib/capacity";

import CapacityGrid from "./CapacityGrid";

const row = (id: number, name: string, s: Partial<Record<number, number>>): MemberCapacityRow => {
  const slots = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, ...s } as MemberCapacityRow["slots"];
  return {
    member: { id, name, team_id: 1, team_name: null },
    slots,
    total: Object.values(slots).reduce((a, b) => a + b, 0),
  };
};

it("renders a row per member with per-iteration capacity and · for zero", () => {
  render(<CapacityGrid rows={[row(1, "Marco", { 1: 5, 2: 5 }), row(2, "Manuela", { 1: 3 })]} />);
  expect(screen.getByText("Marco")).toBeInTheDocument();
  expect(screen.getByText("Manuela")).toBeInTheDocument();

  const marcoRow = screen.getByText("Marco").closest("[data-testid='capacity-row']") as HTMLElement;
  expect(within(marcoRow).getAllByText("5")).toHaveLength(2);
  expect(within(marcoRow).getAllByText("·").length).toBeGreaterThan(0);
});

it("renders a Total row summing the columns", () => {
  render(<CapacityGrid rows={[row(1, "Marco", { 1: 5 }), row(2, "Manuela", { 1: 3 })]} />);
  const totalRow = screen.getByText("Total").closest("[data-testid='capacity-total']") as HTMLElement;
  expect(within(totalRow).getByText("8")).toBeInTheDocument();
});
