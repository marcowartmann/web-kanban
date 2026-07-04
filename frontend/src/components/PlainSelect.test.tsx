import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import PlainSelect from "./PlainSelect";

it("is a native select (no search input) and reports the picked value", async () => {
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
  const sel = screen.getByRole("combobox", { name: "Status" });
  expect(sel.tagName).toBe("SELECT");
  await userEvent.selectOptions(sel, "Ready");
  expect(onChange).toHaveBeenCalledWith("Ready");
});

it("selecting the placeholder clears to null", async () => {
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
  const sel = screen.getByRole("combobox", { name: "Status" });
  await userEvent.selectOptions(sel, "");
  expect(onChange).toHaveBeenCalledWith(null);
});
