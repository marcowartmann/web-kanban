import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import RankingView from "./RankingView";
import type { AuthUser, Item } from "../types";

function feat(id: number, title: string, team: string | null, wsjf: number | null, rank: number | null): Item {
  return { id, kind: "feature", title, leading_team: team, wsjf_score: wsjf, manual_rank: rank } as Item;
}

const user = { id: 1, display_name: "U", role: "member", is_active: true, team_name: "Net" } as AuthUser;

const items: Item[] = [
  feat(1, "Alpha", "Net", 10, null),
  feat(2, "Bravo", "Cloud", 20, null),
  feat(3, "Charlie", "Net", 5, null),
];

function renderView() {
  render(
    <RankingView items={items} planningIntervals={[]} teams={["Net", "Cloud"]} containers={[]} user={user} onChanged={vi.fn()} />,
  );
}

it("renders the WSJF list in descending score order", () => {
  renderView();
  const wsjf = screen.getByTestId("wsjf-list");
  const titles = within(wsjf).getAllByTestId("rank-title").map((n) => n.textContent);
  expect(titles).toEqual(["Bravo", "Alpha", "Charlie"]);
});

it("shows the feature id in both lists", () => {
  renderView();
  expect(within(screen.getByTestId("wsjf-list")).getByText("#2")).toBeInTheDocument();
  expect(within(screen.getByTestId("manual-list")).getByText("#2")).toBeInTheDocument();
});

it("shows WSJF rank and a colored delta per manual row", () => {
  // manual_rank set so manual order differs from WSJF order.
  const ranked: Item[] = [
    feat(1, "Alpha", "Net", 10, 1), // wsjf #2 → manual #1 → up 1
    feat(2, "Bravo", "Cloud", 20, 2), // wsjf #1 → manual #2 → down 1
    feat(3, "Charlie", "Net", 5, 3), // wsjf #3 → manual #3 → none
  ];
  render(
    <RankingView items={ranked} planningIntervals={[]} teams={["Net", "Cloud"]} containers={[]} user={user} onChanged={vi.fn()} />,
  );
  const rows = within(screen.getByTestId("manual-list")).getAllByTestId("manual-row");
  const byTitle = Object.fromEntries(
    rows.map((r) => [within(r).getByTestId("rank-title").textContent, r]),
  );
  const alphaDelta = within(byTitle["Alpha"]).getByTestId("delta");
  expect(alphaDelta).toHaveAttribute("data-direction", "up");
  expect(alphaDelta.textContent).toContain("1");
  expect(within(byTitle["Alpha"]).getByTestId("wsjf-rank").textContent).toContain("2");

  const bravoDelta = within(byTitle["Bravo"]).getByTestId("delta");
  expect(bravoDelta).toHaveAttribute("data-direction", "down");
  expect(bravoDelta.textContent).toContain("1");

  expect(within(byTitle["Charlie"]).getByTestId("delta")).toHaveAttribute("data-direction", "none");
});

it("marks only own-team rows draggable in the manual list", () => {
  renderView();
  const manual = screen.getByTestId("manual-list");
  const rows = within(manual).getAllByTestId("manual-row");
  const byTitle = Object.fromEntries(
    rows.map((r) => [within(r).getByTestId("rank-title").textContent, r.getAttribute("data-draggable")]),
  );
  expect(byTitle["Alpha"]).toBe("true");
  expect(byTitle["Charlie"]).toBe("true");
  expect(byTitle["Bravo"]).toBe("false");
});
