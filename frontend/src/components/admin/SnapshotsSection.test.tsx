import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { SnapshotInfo } from "../../types";
import SnapshotsSection from "./SnapshotsSection";

afterEach(() => vi.restoreAllMocks());

const SNAP: SnapshotInfo = {
  name: "import-snapshot-20260702T120000-000000Z.json",
  created_at: "2026-07-02T12:00:00+00:00",
  actor: "admin@example.com",
  items: 131,
  comments: 12,
  links: 5,
};

it("renders snapshot rows with counts and a download link", async () => {
  vi.spyOn(client, "listSnapshots").mockResolvedValue([SNAP]);
  render(<SnapshotsSection onChanged={() => {}} />);
  expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
  expect(screen.getByText("131")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Download" });
  expect(link).toHaveAttribute(
    "href",
    "/api/v1/import/snapshots/import-snapshot-20260702T120000-000000Z.json/download",
  );
});

it("shows the empty state", async () => {
  vi.spyOn(client, "listSnapshots").mockResolvedValue([]);
  render(<SnapshotsSection onChanged={() => {}} />);
  expect(await screen.findByText(/no snapshots yet — create one here/i)).toBeInTheDocument();
});

it("Create snapshot posts, reports counts, and reloads the list", async () => {
  const listSpy = vi
    .spyOn(client, "listSnapshots")
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([SNAP]);
  const createSpy = vi.spyOn(client, "createSnapshot").mockResolvedValue(SNAP);
  render(<SnapshotsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Create snapshot" }));
  expect(
    await screen.findByText("Snapshot created — 131 items, 12 comments, 5 links"),
  ).toBeInTheDocument();
  expect(createSpy).toHaveBeenCalled();
  await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
});

it("cancelling the dialog does not restore", async () => {
  vi.spyOn(client, "listSnapshots").mockResolvedValue([SNAP]);
  const restoreSpy = vi.spyOn(client, "restoreSnapshot");
  render(<SnapshotsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /restore snapshot/i }));
  const dialog = screen.getByRole("alertdialog", { name: "Restore snapshot?" });
  expect(dialog).toHaveTextContent(SNAP.name);
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(restoreSpy).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

const OLDER: SnapshotInfo = {
  name: "import-snapshot-20260701T120000-000000Z.json",
  created_at: "2026-07-01T12:00:00+00:00",
  actor: "admin@example.com",
  items: 100,
  comments: 4,
  links: 2,
};

it("deletes a non-newest snapshot without force and reloads", async () => {
  // Newest-first list: SNAP is newest, OLDER is not.
  const listSpy = vi
    .spyOn(client, "listSnapshots")
    .mockResolvedValueOnce([SNAP, OLDER])
    .mockResolvedValueOnce([SNAP]);
  const delSpy = vi.spyOn(client, "deleteSnapshot").mockResolvedValue(undefined);
  render(<SnapshotsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: `delete snapshot ${OLDER.name}` }));
  const dialog = screen.getByRole("alertdialog", { name: "Delete snapshot?" });
  expect(dialog).not.toHaveTextContent(/most recent/i);
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  expect(delSpy).toHaveBeenCalledWith(OLDER.name, false);
  expect(await screen.findByText("Snapshot deleted")).toBeInTheDocument();
  await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
});

it("guards the newest snapshot: dialog warns and delete forces", async () => {
  vi.spyOn(client, "listSnapshots").mockResolvedValue([SNAP, OLDER]);
  const delSpy = vi.spyOn(client, "deleteSnapshot").mockResolvedValue(undefined);
  render(<SnapshotsSection onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: `delete snapshot ${SNAP.name}` }));
  const dialog = screen.getByRole("alertdialog", { name: "Delete snapshot?" });
  expect(dialog).toHaveTextContent(/most recent snapshot/i);
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  expect(delSpy).toHaveBeenCalledWith(SNAP.name, true);
});

it("confirmed restore reports counts and reloads the list", async () => {
  const listSpy = vi.spyOn(client, "listSnapshots").mockResolvedValue([SNAP]);
  vi.spyOn(client, "restoreSnapshot").mockResolvedValue({
    items: 131, comments: 12, links: 5, warnings: ["one"],
  });
  const onChanged = vi.fn();
  render(<SnapshotsSection onChanged={onChanged} />);
  await userEvent.click(await screen.findByRole("button", { name: /restore snapshot/i }));
  const dialog = screen.getByRole("alertdialog", { name: "Restore snapshot?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
  expect(
    await screen.findByText("Restored 131 items, 12 comments, 5 links — 1 warning(s)"),
  ).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalled();
  await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
});
