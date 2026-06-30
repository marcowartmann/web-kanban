import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Board from "./Board";
import * as client from "../api/client";

afterEach(() => vi.restoreAllMocks());

const sampleBoard = [
  {
    status: "Analyzing",
    cards: [
      {
        id: 1, kind: "feature", title: "Feature One", status: "Analyzing",
        wsjf_score: 60, leading_team: "Network", iteration: "PI1-Q3",
        children_count: 3, children_points: 4.5, parent_id: null, position: 0,
        type: "Enabler Feature", description: null, kategorie: null, art: null,
        sdi_prio: null, tshirt_size: "XS", story_points: null,
        supporting_team: null, externer_partner: null, assignee: null,
        akzeptanzkriterien: null, dependencies: null, bo_stakeholder: null,
        business_value: null, time_criticality: null, risk_reduction: null,
        cost_of_delay: null, job_size: null, definition_of_done: null,
      },
    ],
  },
  { status: "Unscheduled", cards: [] },
];

it("renders a column per status and a card per item", async () => {
  vi.spyOn(client, "getBoard").mockResolvedValue(sampleBoard as never);
  render(<Board onOpenCard={() => {}} />);

  expect(await screen.findByText("Feature One")).toBeInTheDocument();
  expect(screen.getByText("Analyzing")).toBeInTheDocument();
  expect(screen.getByText("Unscheduled")).toBeInTheDocument();
  // card surfaces WSJF and child-story count
  expect(screen.getByText(/60/)).toBeInTheDocument();
  expect(screen.getByText(/3 stories/i)).toBeInTheDocument();
});
