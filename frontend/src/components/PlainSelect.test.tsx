import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import PlainSelect from "./PlainSelect";

it("opens a styled option list and reports the picked value", async () => {
  const onChange = vi.fn();
  render(
    <PlainSelect
      ariaLabel="Status"
      value={null}
      options={["Funnel", "Ready"]}
      onChange={onChange}
      placeholder="Select status…"
    />,
  );
  // Closed: placeholder shown, options not in the DOM.
  const trigger = screen.getByRole("combobox", { name: "Status" });
  expect(screen.queryByRole("option")).toBeNull();

  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("option", { name: "Ready" }));
  expect(onChange).toHaveBeenCalledWith("Ready");
});

it("marks the current value as selected when open", async () => {
  render(
    <PlainSelect
      ariaLabel="Status"
      value="Ready"
      options={["Funnel", "Ready"]}
      onChange={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
  expect(screen.getByRole("option", { name: "Ready" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("option", { name: "Funnel" })).toHaveAttribute("aria-selected", "false");
});

it("can clear back to null via the placeholder option", async () => {
  const onChange = vi.fn();
  render(
    <PlainSelect
      ariaLabel="Status"
      value="Ready"
      options={["Funnel", "Ready"]}
      onChange={onChange}
      placeholder="Select status…"
    />,
  );
  await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
  await userEvent.click(screen.getByRole("option", { name: "Select status…" }));
  expect(onChange).toHaveBeenCalledWith(null);
});

it("shows the placeholder when there is no value", () => {
  render(
    <PlainSelect
      ariaLabel="Status"
      value={null}
      options={["Funnel"]}
      onChange={vi.fn()}
      placeholder="Select status…"
    />,
  );
  expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Select status…");
});
