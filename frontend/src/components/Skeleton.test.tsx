import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { Skeleton, SkeletonRows } from "./Skeleton";

it("pulses only when motion is allowed", () => {
  const { container } = render(<Skeleton className="h-4" />);
  expect(container.firstElementChild).toHaveClass("motion-safe:animate-pulse", "bg-gray-100");
});

it("SkeletonRows renders the requested count with a loading label", () => {
  const { getAllByTestId, getByLabelText } = render(<SkeletonRows rows={3} />);
  expect(getByLabelText("Loading")).toBeInTheDocument();
  expect(getAllByTestId("skeleton-row")).toHaveLength(3);
});
