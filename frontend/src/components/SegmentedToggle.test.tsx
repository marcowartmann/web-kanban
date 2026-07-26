import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import SegmentedToggle from "./SegmentedToggle";

it("renders a radiogroup and switches on click", async () => {
  const onChange = vi.fn();
  render(
    <SegmentedToggle
      ariaLabel="Mode"
      value="feature"
      onChange={onChange}
      options={[
        { value: "feature", label: "By feature" },
        { value: "deps", label: "Dependencies" },
      ]}
    />,
  );
  const group = screen.getByRole("radiogroup", { name: "Mode" });
  expect(within(group).getByRole("radio", { name: "By feature" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await userEvent.click(within(group).getByRole("radio", { name: "Dependencies" }));
  expect(onChange).toHaveBeenCalledWith("deps");
});
