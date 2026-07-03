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
