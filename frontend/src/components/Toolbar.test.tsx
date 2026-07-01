import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { ItemKind } from "../types";
import Toolbar from "./Toolbar";

const baseProps = {
  planningIntervals: ["PI1-Q3"],
  teams: ["Network"],
  assignees: ["Marco Wartmann", "Adrian Senn"],
  kindOptions: ["feature", "story", "risk"] as ItemKind[],
};

it("emits the search query on type", async () => {
  const onChange = vi.fn();
  render(<Toolbar filters={{}} onChange={onChange} {...baseProps} />);
  await userEvent.type(screen.getByPlaceholderText(/search/i), "teton");
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ q: "teton" }));
});

it("emits a planning-interval filter when an option is picked", async () => {
  const onChange = vi.fn();
  render(<Toolbar filters={{}} onChange={onChange} {...baseProps} />);
  await userEvent.click(screen.getByRole("button", { name: /planning interval/i }));
  await userEvent.click(screen.getByRole("option", { name: "PI1-Q3" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ planning_interval: "PI1-Q3" }),
  );
});

it("emits an assignee filter when an option is picked", async () => {
  const onChange = vi.fn();
  render(<Toolbar filters={{}} onChange={onChange} {...baseProps} />);
  await userEvent.click(screen.getByRole("button", { name: /assignee/i }));
  await userEvent.click(screen.getByRole("option", { name: "Adrian Senn" }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ assignee: "Adrian Senn" }));
});

it("adds a kind when its pill is clicked", async () => {
  const onChange = vi.fn();
  render(<Toolbar filters={{ kinds: ["feature", "risk"] }} onChange={onChange} {...baseProps} />);
  await userEvent.click(screen.getByRole("button", { name: /story/i }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ kinds: ["feature", "risk", "story"] }),
  );
});

it("removes a kind when its active pill is clicked", async () => {
  const onChange = vi.fn();
  render(<Toolbar filters={{ kinds: ["feature", "risk"] }} onChange={onChange} {...baseProps} />);
  await userEvent.click(screen.getByRole("button", { name: /risk/i }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ kinds: ["feature"] }),
  );
});

it("clears every filter when Clear all is clicked", async () => {
  const onChange = vi.fn();
  render(
    <Toolbar
      filters={{ q: "x", planning_interval: "PI1-Q3", kinds: ["feature"] }}
      onChange={onChange}
      {...baseProps}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /clear all/i }));
  expect(onChange).toHaveBeenCalledWith({});
});

it("hides Clear all when no filter is active", () => {
  render(<Toolbar filters={{}} onChange={() => {}} {...baseProps} />);
  expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
});
