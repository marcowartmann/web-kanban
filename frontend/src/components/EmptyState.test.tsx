import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import EmptyState from "./EmptyState";

it("renders the message and optional action", () => {
  render(<EmptyState action={<button>Add one</button>}>No streams yet.</EmptyState>);
  expect(screen.getByText("No streams yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add one" })).toBeInTheDocument();
});
