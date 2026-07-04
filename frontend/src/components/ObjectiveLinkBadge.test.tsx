import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect, it } from "vitest";
import { ObjectiveLinksContext } from "../objectives/links";
import ObjectiveLinkBadge from "./ObjectiveLinkBadge";

const withLinks = (ui: ReactElement, ids: number[]) =>
  render(<ObjectiveLinksContext.Provider value={new Set(ids)}>{ui}</ObjectiveLinksContext.Provider>);

const badge = () => screen.queryByRole("img", { name: /linked to a pi objective/i });

it("shows for a linked feature", () => {
  withLinks(<ObjectiveLinkBadge kind="feature" id={5} />, [5]);
  expect(badge()).toBeInTheDocument();
});

it("hides for an unlinked feature", () => {
  withLinks(<ObjectiveLinkBadge kind="feature" id={5} />, [9]);
  expect(badge()).toBeNull();
});

it("shows for a story whose parent feature is linked", () => {
  withLinks(<ObjectiveLinkBadge kind="story" id={2} parentId={5} />, [5]);
  expect(badge()).toBeInTheDocument();
});

it("hides for a story whose parent is not linked", () => {
  withLinks(<ObjectiveLinkBadge kind="story" id={2} parentId={7} />, [5]);
  expect(badge()).toBeNull();
});

it("hides without a provider (default empty set)", () => {
  render(<ObjectiveLinkBadge kind="feature" id={5} />);
  expect(badge()).toBeNull();
});
