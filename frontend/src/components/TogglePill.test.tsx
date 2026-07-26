import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import TogglePill from "./TogglePill";

it("toggles with aria-pressed", async () => {
  const onChange = vi.fn();
  render(
    <TogglePill active={false} onChange={onChange}>
      Only at risk
    </TogglePill>,
  );
  const btn = screen.getByRole("button", { name: "Only at risk" });
  expect(btn).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(btn);
  expect(onChange).toHaveBeenCalledWith(true);
});
