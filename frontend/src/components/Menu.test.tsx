import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import Menu from "./Menu";

function renderMenu() {
  const onSelect = vi.fn();
  render(
    <Menu
      ariaLabel="Stream actions"
      trigger={() => <span>⋮</span>}
      items={[
        { label: "Move up", onSelect, disabled: true },
        { label: "Rename", onSelect },
        { label: "Delete", onSelect, danger: true },
      ]}
    />,
  );
  return onSelect;
}

it("opens with the full menu contract and selects with Enter", async () => {
  const onSelect = renderMenu();
  const trigger = screen.getByRole("button", { name: "Stream actions" });
  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
  await userEvent.keyboard("{ArrowDown}"); // skips disabled → Rename
  expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(onSelect).toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("Escape closes and returns focus to the trigger", async () => {
  renderMenu();
  const trigger = screen.getByRole("button", { name: "Stream actions" });
  await userEvent.click(trigger);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("danger items render the red item style", async () => {
  renderMenu();
  await userEvent.click(screen.getByRole("button", { name: "Stream actions" }));
  expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveClass("text-red-600");
});

it("ArrowUp/Home/End move focus and wrap once inside the menu", async () => {
  renderMenu();
  await userEvent.click(screen.getByRole("button", { name: "Stream actions" }));
  await userEvent.keyboard("{ArrowDown}"); // enters the menu → first enabled item (Rename)
  expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}"); // wraps past disabled Move up → Rename
  expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}"); // wraps back to Delete (Move up skipped)
  expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  await userEvent.keyboard("{Home}");
  expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
});

it("outside mousedown closes the menu", async () => {
  renderMenu();
  await userEvent.click(screen.getByRole("button", { name: "Stream actions" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await userEvent.click(document.body);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
