import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import NewItemBar from "./NewItemBar";

afterEach(() => vi.restoreAllMocks());

it("creates a feature through the dialog (Enter submits)", async () => {
  const create = vi.spyOn(client, "createItem").mockResolvedValue({ id: 1 } as never);
  const onCreated = vi.fn();
  render(<NewItemBar onCreated={onCreated} />);
  await userEvent.click(screen.getByRole("button", { name: /new feature/i }));
  await userEvent.type(screen.getByLabelText("Title"), "Brand New Feature{Enter}");
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "feature", title: "Brand New Feature" }),
  );
  expect(onCreated).toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("Create is disabled while blank; Cancel closes without creating", async () => {
  const create = vi.spyOn(client, "createItem").mockResolvedValue({ id: 1 } as never);
  render(<NewItemBar onCreated={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /new risk/i }));
  expect(screen.getByRole("dialog", { name: "New risk" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("Escape closes the dialog without creating", async () => {
  const create = vi.spyOn(client, "createItem").mockResolvedValue({ id: 1 } as never);
  render(<NewItemBar onCreated={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /new feature/i }));
  await userEvent.type(screen.getByLabelText("Title"), "typed{Escape}");
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
