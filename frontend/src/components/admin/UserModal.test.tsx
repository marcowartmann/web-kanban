import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import { ConflictError } from "../../api/client";
import UserModal from "./UserModal";

afterEach(() => vi.restoreAllMocks());

const teams = [
  { id: 1, name: "Network" },
  { id: 2, name: "Cloud" },
] as never;

const departments = [
  { id: 3, name: "Frontend", team_id: 1, team_name: "Network", member_ids: [] },
] as never;

const ben = {
  id: 2, email: "b@b.ch", display_name: "Ben", role: "member",
  is_active: true, team_id: 1, team_name: "Network",
} as never;

it("edit: saves only the changed fields", async () => {
  const update = vi.spyOn(client, "updateUser").mockResolvedValue(ben);
  const onSaved = vi.fn();
  render(
    <UserModal mode="edit" user={ben} teams={teams} departments={departments} currentUserId={1} onSaved={onSaved} onClose={() => {}} />,
  );
  const email = screen.getByLabelText(/email/i);
  await userEvent.clear(email);
  await userEvent.type(email, "new@b.ch");
  await userEvent.click(screen.getByRole("combobox", { name: /team/i }));
  await userEvent.click(screen.getByRole("option", { name: "Cloud" }));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(update).toHaveBeenCalledWith(2, { email: "new@b.ch", team_id: 2 });
  expect(onSaved).toHaveBeenCalled();
});

it("edit: rejected save shows the server detail inline", async () => {
  vi.spyOn(client, "updateUser").mockRejectedValue(new ConflictError("Email already in use"));
  render(
    <UserModal mode="edit" user={ben} teams={teams} departments={departments} currentUserId={1} onSaved={() => {}} onClose={() => {}} />,
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
    <UserModal mode="edit" user={ben} teams={teams} departments={departments} currentUserId={2} onSaved={() => {}} onClose={() => {}} />,
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
  render(<UserModal mode="create" teams={teams} departments={departments} currentUserId={1} onSaved={() => {}} onClose={() => {}} />);
  const save = screen.getByRole("button", { name: /^save$/i });
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/display name/i), "Cleo");
  await userEvent.type(screen.getByLabelText(/username/i), "cleo");
  await userEvent.type(screen.getByLabelText(/email/i), "c@b.ch");
  await userEvent.type(screen.getByLabelText(/^password$/i), "pw123456");
  await userEvent.click(screen.getByRole("combobox", { name: /team/i }));
  await userEvent.click(screen.getByRole("option", { name: "Network" }));
  await userEvent.click(save);
  expect(create).toHaveBeenCalledWith({
    email: "c@b.ch",
    username: "cleo",
    display_name: "Cleo",
    password: "pw123456",
    role: "member",
    team_id: 1,
  });
});

it("create: name only posts null email and password (person, no login)", async () => {
  const create = vi.spyOn(client, "createUser").mockResolvedValue(ben);
  render(<UserModal mode="create" teams={teams} departments={departments} currentUserId={1} onSaved={() => {}} onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText(/display name/i), "Cleo");
  const save = screen.getByRole("button", { name: /^save$/i });
  expect(save).not.toBeDisabled();
  await userEvent.click(save);
  expect(create).toHaveBeenCalledWith({
    email: null,
    username: null,
    display_name: "Cleo",
    password: null,
    role: "member",
    team_id: null,
  });
});

it("edit: clearing the username of a passworded user surfaces the server detail", async () => {
  const withLogin = { ...(ben as Record<string, unknown>), username: "ben" } as never;
  const update = vi.spyOn(client, "updateUser").mockRejectedValue(
    new Error('422 Unprocessable Entity: {"detail":"Password requires a username"}'),
  );
  render(
    <UserModal mode="edit" user={withLogin} teams={teams} departments={departments} currentUserId={1} onSaved={() => {}} onClose={() => {}} />,
  );
  const username = screen.getByLabelText(/username/i);
  await userEvent.clear(username);
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(await screen.findByText("Password requires a username")).toBeInTheDocument();
  expect(update).toHaveBeenCalledWith(2, { username: null });
});

it("edit: changing departments calls setUserDepartments", async () => {
  vi.spyOn(client, "updateUser").mockResolvedValue(ben);
  const setDepts = vi.spyOn(client, "setUserDepartments").mockResolvedValue(ben);
  const withDept = { ...(ben as Record<string, unknown>), department_ids: [] } as never;
  render(
    <UserModal mode="edit" user={withDept} teams={teams} departments={departments} currentUserId={1} onSaved={() => {}} onClose={() => {}} />,
  );
  await userEvent.click(screen.getByLabelText(/Frontend/));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(setDepts).toHaveBeenCalledWith(2, [3]);
});

it("create: a password without a username keeps Save disabled", async () => {
  render(<UserModal mode="create" teams={teams} departments={departments} currentUserId={1} onSaved={() => {}} onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText(/display name/i), "Cleo");
  await userEvent.type(screen.getByLabelText(/^password$/i), "pw123456");
  expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/username/i), "cleo");
  expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
});
