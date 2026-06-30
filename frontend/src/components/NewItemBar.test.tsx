import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import NewItemBar from "./NewItemBar";

afterEach(() => vi.restoreAllMocks());

it("creates a feature with the prompted title", async () => {
  const create = vi.spyOn(client, "createItem").mockResolvedValue({ id: 1 } as never);
  vi.spyOn(window, "prompt").mockReturnValue("Brand New Feature");
  const onCreated = vi.fn();
  render(<NewItemBar onCreated={onCreated} />);
  await userEvent.click(screen.getByRole("button", { name: /new feature/i }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "feature", title: "Brand New Feature" }),
  );
  expect(onCreated).toHaveBeenCalled();
});

it("does nothing if the prompt is cancelled", async () => {
  const create = vi.spyOn(client, "createItem").mockResolvedValue({ id: 1 } as never);
  vi.spyOn(window, "prompt").mockReturnValue(null);
  render(<NewItemBar onCreated={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /new risk/i }));
  expect(create).not.toHaveBeenCalled();
});
