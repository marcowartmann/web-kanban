import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Item } from "../types";
import FeatureCard from "./FeatureCard";

const feature = { id: 3, kind: "feature", type: "Feature", title: "Auth" } as unknown as Item;

it("shows the feature title, id, and dependency badges, and opens on click", async () => {
  const onOpen = vi.fn();
  render(
    <FeatureCard
      feature={feature}
      info={{ blocks_count: 2, blocked_by_count: 0, related_count: 0, conflicts: [], conflictPartners: [], linkPartners: [7] }}
      onOpen={onOpen}
    />,
  );
  expect(screen.getByText("Auth")).toBeInTheDocument();
  expect(screen.getByText("#3")).toBeInTheDocument();
  expect(screen.getByText(/blocks 2/i)).toBeInTheDocument();
  await userEvent.click(screen.getByText("Auth"));
  expect(onOpen).toHaveBeenCalledWith(3);
});
