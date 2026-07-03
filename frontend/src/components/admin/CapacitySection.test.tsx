import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import CapacitySection from "./CapacitySection";

afterEach(() => vi.restoreAllMocks());

it("commits a capacity edit on blur", async () => {
  vi.spyOn(client, "getPersonOptions").mockResolvedValue([
    { id: 1, display_name: "Marco" },
  ]);
  vi.spyOn(client, "getCapacities").mockResolvedValue([]);
  const up = vi.spyOn(client, "upsertCapacity").mockResolvedValue({
    id: 1, user_id: 1, planning_interval: "PI1-Q3", iteration: 2, points: 5,
  });

  render(<CapacitySection planningIntervals={["PI1-Q3"]} />);
  const cell = await screen.findByLabelText("Marco Iteration 2");
  fireEvent.change(cell, { target: { value: "5" } });
  fireEvent.blur(cell);

  await waitFor(() =>
    expect(up).toHaveBeenCalledWith({
      user_id: 1, planning_interval: "PI1-Q3", iteration: 2, points: 5,
    }),
  );
});

it("shows an empty state when there are no planning intervals", () => {
  vi.spyOn(client, "getPersonOptions").mockResolvedValue([]);
  vi.spyOn(client, "getCapacities").mockResolvedValue([]);
  render(<CapacitySection planningIntervals={[]} />);
  expect(screen.getByText(/no planning intervals yet/i)).toBeInTheDocument();
});
