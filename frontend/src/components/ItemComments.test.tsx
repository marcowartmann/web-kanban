import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { AuthProvider } from "../auth/AuthContext";
import ItemComments from "./ItemComments";

afterEach(() => vi.restoreAllMocks());

const anna = { id: 1, email: "a@b.ch", display_name: "Anna", role: "member", is_active: true } as const;
const admin = { id: 9, email: "r@b.ch", display_name: "Root", role: "admin", is_active: true } as const;

const comment = (over: object = {}) => ({
  id: 1, item_id: 5, parent_id: null, author_id: 1, author_name: "Anna",
  body: "First!", created_at: "2026-07-02T10:00:00", updated_at: null,
  ...over,
});

function renderAs(user: typeof anna | typeof admin, comments: unknown[]) {
  vi.spyOn(client, "getMe").mockResolvedValue(user as never);
  vi.spyOn(client, "getComments").mockResolvedValue(comments as never);
  render(
    <AuthProvider>
      <ItemComments itemId={5} />
    </AuthProvider>,
  );
}

it("renders author, date, edited marker, and indented replies", async () => {
  renderAs(anna, [
    comment(),
    comment({ id: 2, parent_id: 1, author_id: 3, author_name: "Ben", body: "A reply", updated_at: "2026-07-02T11:00:00" }),
  ]);
  expect(await screen.findByText("First!")).toBeInTheDocument();
  expect(screen.getByText("Anna")).toBeInTheDocument();
  expect(screen.getByText("A reply")).toBeInTheDocument();
  expect(screen.getByText("Ben")).toBeInTheDocument();
  expect(screen.getByText("(edited)")).toBeInTheDocument();
});

it("posts a new comment and a reply with the right payloads", async () => {
  const create = vi.spyOn(client, "createComment").mockResolvedValue(comment() as never);
  renderAs(anna, [comment()]);
  await screen.findByText("First!");

  await userEvent.type(screen.getByPlaceholderText(/write a comment/i), "New thoughts");
  await userEvent.click(screen.getByRole("button", { name: /^post$/i }));
  expect(create).toHaveBeenCalledWith(5, { body: "New thoughts" });

  await userEvent.click(screen.getByRole("button", { name: /^reply$/i }));
  await userEvent.type(screen.getByPlaceholderText(/write a reply/i), "Me too");
  await userEvent.click(screen.getByRole("button", { name: /post reply/i }));
  expect(create).toHaveBeenCalledWith(5, { body: "Me too", parent_id: 1 });
});

it("edits own comment inline", async () => {
  const update = vi.spyOn(client, "updateComment").mockResolvedValue(comment({ body: "v2" }) as never);
  renderAs(anna, [comment()]);
  await screen.findByText("First!");
  await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
  const box = screen.getByDisplayValue("First!");
  await userEvent.clear(box);
  await userEvent.type(box, "v2");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(update).toHaveBeenCalledWith(1, "v2");
});

it("hides Edit/Delete on others' comments for members, shows them for admins", async () => {
  renderAs(anna, [comment({ id: 3, author_id: 42, author_name: "Zoe" })]);
  await screen.findByText("First!");
  expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  vi.restoreAllMocks();
  renderAs(admin, [comment({ id: 3, author_id: 42, author_name: "Zoe" })]);
  expect((await screen.findAllByRole("button", { name: /^edit$/i })).length).toBe(1);
});

it("confirms before deleting a comment that has replies", async () => {
  const del = vi.spyOn(client, "deleteComment").mockResolvedValue(undefined as never);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  renderAs(anna, [comment(), comment({ id: 2, parent_id: 1, author_id: 1, body: "r" })]);
  await screen.findByText("First!");
  await userEvent.click(screen.getAllByRole("button", { name: /^delete$/i })[0]);
  expect(confirm).toHaveBeenCalledWith("Delete this comment and its replies?");
  expect(del).not.toHaveBeenCalled();
});

it("shows an inline error and keeps the draft when posting a comment fails", async () => {
  vi.spyOn(client, "createComment").mockRejectedValue(new Error("boom"));
  renderAs(anna, [comment()]);
  await screen.findByText("First!");

  const textarea = screen.getByPlaceholderText(/write a comment/i);
  await userEvent.type(textarea, "New thoughts");
  await userEvent.click(screen.getByRole("button", { name: /^post$/i }));

  expect(await screen.findByText("Could not save your comment. Try again.")).toBeInTheDocument();
  expect(textarea).toHaveValue("New thoughts");
});
