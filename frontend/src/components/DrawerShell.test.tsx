import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";
import DrawerShell from "./DrawerShell";

function renderShell(footerOverrides?: {
  onDelete?: () => void;
  deleteLabel?: string;
  saveLabel?: string;
  saving?: boolean;
}) {
  const onClose = vi.fn();
  const onCancel = vi.fn();
  const onSave = vi.fn();
  render(
    <DrawerShell title="Widget" onClose={onClose} footer={{ onCancel, onSave, ...footerOverrides }}>
      <p>Body</p>
    </DrawerShell>,
  );
  return { onClose, onCancel, onSave };
}

it("renders title, backdrop, and the Delete|Cancel+Save footer order", async () => {
  renderShell({ onDelete: vi.fn() });
  const buttons = screen.getAllByRole("button");
  // order: close ✕ (header), Delete, Cancel, Save
  expect(buttons.map((b) => b.textContent)).toEqual(["", "Delete", "Cancel", "Save"]);
  expect(screen.getByRole("heading", { name: "Widget" })).toBeInTheDocument();
  expect(screen.getByTestId("drawer-backdrop")).toBeInTheDocument();
});

it("Escape and backdrop click close; panel clicks do not", async () => {
  const { onClose } = renderShell();
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByTestId("drawer-backdrop"));
  expect(onClose).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole("heading"));
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("the body wrapper is a flex column so bare label+input bodies stack full-width", () => {
  renderShell();
  // Primitive-contract class assertion: drawer bodies rely on column-stretch
  // for block flow; losing flex-col regresses every catalog drawer's layout.
  expect(screen.getByTestId("drawer-body")).toHaveClass(
    "flex",
    "flex-col",
    "flex-1",
    "overflow-y-auto",
    "[&>*]:shrink-0",
  );
});

it("create mode (no onDelete) renders no Delete button", () => {
  renderShell({ onDelete: undefined });
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});

it("close button is reachable by role and accessible name", async () => {
  const { onClose } = renderShell();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("Cancel and Save call the footer handlers", async () => {
  const { onCancel, onSave } = renderShell();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onSave).toHaveBeenCalledOnce();
});

it("headerExtra renders next to the title, and saving disables Save", () => {
  render(
    <DrawerShell
      title="Widget"
      headerExtra={<span data-testid="extra">extra</span>}
      onClose={vi.fn()}
      footer={{ onCancel: vi.fn(), onSave: vi.fn(), saving: true }}
    >
      <p>Body</p>
    </DrawerShell>,
  );
  expect(screen.getByTestId("extra")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("custom deleteLabel and saveLabel are used", () => {
  renderShell({ onDelete: vi.fn(), deleteLabel: "Remove", saveLabel: "Publish" });
  expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
});

it("Escape closes only a nested ConfirmDialog, not the drawer underneath", async () => {
  const drawerClose = vi.fn();
  const dialogClose = vi.fn();
  render(
    <DrawerShell
      title="Widget"
      onClose={drawerClose}
      footer={{ onCancel: vi.fn(), onSave: vi.fn() }}
    >
      <ConfirmDialog
        title="Delete widget"
        message="Are you sure?"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onClose={dialogClose}
      />
    </DrawerShell>,
  );
  await userEvent.keyboard("{Escape}");
  expect(dialogClose).toHaveBeenCalledTimes(1);
  expect(drawerClose).not.toHaveBeenCalled();
});
