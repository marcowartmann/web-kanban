import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import UserModal from "./UserModal";

afterEach(() => vi.restoreAllMocks());

const teams = [
  { id: 1, name: "Network" },
  { id: 2, name: "Cloud" },
] as never;

const ben = {
  id: 2, email: "b@b.ch", display_name: "Ben", role: "member",
  is_active: true, team_id: 1, team_name: "Network",
} as never;

it("edit: saves only the changed fields", async () => {
  const update = vi.spyOn(client, "updateUser").mockResolvedValue(ben);
  const onSaved = vi.fn();
  render(
    <UserModal mode="edit" user={ben} teams={teams} currentUserId={1} onSaved={onSaved} onClose={() => {}} />,
  );
  const email = screen.getByLabelText(/email/i);
  await userEvent.clear(email);
  await userEvent.type(email, "new@b.ch");
  await userEvent.selectOptions(screen.getByLabelText(/team/i), "2");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(update).toHaveBeenCalledWith(2, { email: "new@b.ch", team_id: 2 });
  expect(onSaved).toHaveBeenCalled();
});

it("edit: rejected save shows the server detail inline", async () => {
  vi.spyOn(client, "updateUser").mockRejectedValue(
    new Error('409 Conflict: {"detail":"Email already in use"}'),
  );
  render(
    <UserModal mode="edit" user={ben} teams={teams} currentUserId={1} onSaved={() => {}} onClose={() => {}} />,
  );
  const email = screen.getByLabelText(/email/i);
  await userEvent.clear(email);
  await userEvent.type(email, "taken@b.ch");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(await screen.findByText("Email already in use")).toBeInTheDocument();
});

it("edit: role disabled for the current user; empty password not sent", async () => {
  const update = vi.spyOn(client, "updateUser").mockResolvedValue(ben);
  render(
    <UserModal mode="edit" user={ben} teams={teams} currentUserId={2} onSaved={() => {}} onClose={() => {}} />,
  );
  expect(screen.getByLabelText(/role/i)).toBeDisabled();
  const name = screen.getByLabelText(/display name/i);
  await userEvent.clear(name);
  await userEvent.type(name, "Benny");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(update).toHaveBeenCalledWith(2, { display_name: "Benny" });
});

it("create: save disabled until valid, then sends everything", async () => {
  const create = vi.spyOn(client, "createUser").mockResolvedValue(ben);
  render(<UserModal mode="create" teams={teams} currentUserId={1} onSaved={() => {}} onClose={() => {}} />);
  const save = screen.getByRole("button", { name: /^save$/i });
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/display name/i), "Cleo");
  await userEvent.type(screen.getByLabelText(/email/i), "c@b.ch");
  await userEvent.type(screen.getByLabelText(/^password$/i), "pw123456");
  await userEvent.selectOptions(screen.getByLabelText(/team/i), "1");
  await userEvent.click(save);
  expect(create).toHaveBeenCalledWith({
    email: "c@b.ch",
    display_name: "Cleo",
    password: "pw123456",
    role: "member",
    team_id: 1,
  });
});
