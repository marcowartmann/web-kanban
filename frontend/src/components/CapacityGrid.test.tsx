import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { MemberLoadRow, SlotLoadCap } from "../lib/capacity";
import CapacityGrid from "./CapacityGrid";

const makeSlots = (o: Partial<Record<number, SlotLoadCap>>) => {
  const s = {} as MemberLoadRow["slots"];
  for (let i = 1 as 1 | 2 | 3 | 4 | 5 | 6; i <= 6; i = (i + 1) as typeof i) s[i] = o[i] ?? { load: 0, capacity: 0 };
  return s;
};
const row = (id: number | null, name: string, o: Partial<Record<number, SlotLoadCap>>): MemberLoadRow => {
  const slots = makeSlots(o);
  let totalLoad = 0;
  let totalCapacity = 0;
  for (let i = 1 as 1 | 2 | 3 | 4 | 5 | 6; i <= 6; i = (i + 1) as typeof i) {
    totalLoad += slots[i].load;
    totalCapacity += slots[i].capacity;
  }
  return {
    person: id === null ? null : { id, display_name: name },
    slots,
    totalLoad,
    totalCapacity,
  };
};

it("renders a member row with an avatar (initials) and a load/cap meter", () => {
  render(<CapacityGrid rows={[row(1, "Marco Wartmann", { 1: { load: 3, capacity: 5 } })]} />);
  expect(screen.getByText("Marco Wartmann")).toBeInTheDocument();
  expect(screen.getByText("MW")).toBeInTheDocument();
  const memberRow = screen.getByText("Marco Wartmann").closest("[data-testid='capacity-row']") as HTMLElement;
  expect(within(memberRow).getByText("3 / 5")).toBeInTheDocument();
});

it("renders a Total row aggregating load/cap across members", () => {
  render(
    <CapacityGrid
      rows={[row(1, "Marco", { 1: { load: 3, capacity: 5 } }), row(2, "Mia", { 1: { load: 2, capacity: 5 } })]}
    />,
  );
  const totalRow = screen.getByText("Total").closest("[data-testid='capacity-total']") as HTMLElement;
  expect(within(totalRow).getByText("5 / 10")).toBeInTheDocument();
});

it("shows the Unassigned row when present", () => {
  render(
    <CapacityGrid
      rows={[row(1, "Marco", { 1: { load: 3, capacity: 5 } }), row(null, "Unassigned", { 2: { load: 2, capacity: 0 } })]}
    />,
  );
  expect(screen.getByText("Unassigned")).toBeInTheDocument();
});
