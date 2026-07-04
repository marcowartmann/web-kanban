import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { AuthUser, PIObjective, Team } from "../types";
import PIObjectivesBoard from "./PIObjectivesBoard";

afterEach(() => vi.restoreAllMocks());

const teams: Team[] = [{ id: 1, name: "Network" }];
const user = { id: 1, display_name: "A", role: "admin", team_id: 1 } as unknown as AuthUser;
const obj = (over: Partial<PIObjective>): PIObjective => ({
  id: 1, team_id: 1, team_name: "Network", planning_interval: "PI1-Q3", title: "O1",
  description: null, state: "committed", is_key_delivery: true, position: 0,
  feature_ids: [7, 8], feature_count: 2, ...over,
});

it("renders objectives in state columns with feature count and Key Delivery badge", async () => {
  vi.spyOn(client, "getPIObjectives").mockResolvedValue([
    obj({ id: 1, title: "Committed KD", state: "committed", is_key_delivery: true }),
    obj({ id: 2, title: "Plan B", state: "uncommitted", is_key_delivery: false, feature_ids: [], feature_count: 0 }),
  ]);
  render(<PIObjectivesBoard teams={teams} planningIntervals={["PI1-Q3"]} user={user} features={[]} onChanged={() => {}} />);
  expect(await screen.findByText("Committed KD")).toBeInTheDocument();
  expect(screen.getByText("Plan B")).toBeInTheDocument();
  expect(screen.getByText("Uncommitted")).toBeInTheDocument(); // column header (unique)
  expect(screen.getByText(/2 features/i)).toBeInTheDocument();
  expect(screen.getByText(/key delivery/i)).toBeInTheDocument();
  await waitFor(() => expect(client.getPIObjectives).toHaveBeenCalled());
});
