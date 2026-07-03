import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";

function setup() {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmDialog
      title="Delete item?"
      message="This cannot be undone."
      confirmLabel="Delete"
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  return { onConfirm, onClose };
}

it("renders title, message, and confirm label", () => {
  setup();
  expect(screen.getByRole("alertdialog", { name: "Delete item?" })).toBeInTheDocument();
  expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
});

it("confirm fires onConfirm and not onClose", async () => {
  const { onConfirm, onClose } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
});

it("Cancel holds initial focus and closes without confirming", async () => {
  const { onConfirm, onClose } = setup();
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(cancel).toHaveFocus();
  await userEvent.click(cancel);
  expect(onClose).toHaveBeenCalledOnce();
  expect(onConfirm).not.toHaveBeenCalled();
});

it("Escape and backdrop click close without confirming", async () => {
  const { onConfirm, onClose } = setup();
  await userEvent.keyboard("{Escape}");
  // fireEvent targets the overlay itself; a userEvent click would land on the panel.
  fireEvent.click(screen.getByRole("alertdialog", { name: "Delete item?" }));
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(onConfirm).not.toHaveBeenCalled();
});
