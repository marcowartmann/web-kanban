import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { ConflictError } from "../api/client";
import type { ImportPreview } from "../types";
import ImportButton from "./ImportButton";

afterEach(() => vi.restoreAllMocks());

const PREVIEW: ImportPreview = {
  file_sha256: "sha456",
  state_stamp: "stamp123",
  incoming: { features: 40, stories: 60, risks: 8, warnings: ["Row 2: odd"] },
  current: { features: 3, stories: 5, risks: 1, comments: 7, links: 2 },
  added_titles: ["New thing"],
  removed_titles: ["Old thing"],
  added_more: 0,
  removed_more: 4,
};

function mockPreview(preview: ImportPreview = PREVIEW) {
  return vi.spyOn(client, "previewImport").mockResolvedValue(preview);
}

async function openModal() {
  const file = new File(["Title\nX"], "plan.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText(/import csv/i), file);
  return file;
}

it("shows the preview modal with delete and import counts", async () => {
  mockPreview();
  render(<ImportButton onImported={() => {}} />);
  await openModal();
  expect(await screen.findByText("Replace all data from CSV?")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Will be deleted: 3 features, 5 stories, 1 risks — plus 7 comments and 2 links (not recoverable from CSV)",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("Will be imported: 40 features, 60 stories, 8 risks")).toBeInTheDocument();
  expect(screen.getByText("A snapshot is saved automatically before the import.")).toBeInTheDocument();
});

it("renders warnings and capped title diffs", async () => {
  mockPreview();
  render(<ImportButton onImported={() => {}} />);
  await openModal();
  expect(await screen.findByText("Row 2: odd")).toBeInTheDocument();
  expect(screen.getByText(/New thing/)).toBeInTheDocument();
  expect(screen.getByText(/Old thing … and 4 more/)).toBeInTheDocument();
});

it("cancel closes the modal without importing", async () => {
  mockPreview();
  const importSpy = vi.spyOn(client, "importCsv");
  render(<ImportButton onImported={() => {}} />);
  await openModal();
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(importSpy).not.toHaveBeenCalled();
  expect(screen.queryByText("Replace all data from CSV?")).not.toBeInTheDocument();
});

it("confirm sends the guards and reports counts", async () => {
  mockPreview();
  const importSpy = vi.spyOn(client, "importCsv").mockResolvedValue({
    features: 40, stories: 60, risks: 8, warnings: ["w1"],
  });
  const onImported = vi.fn();
  render(<ImportButton onImported={onImported} />);
  const file = await openModal();
  await userEvent.click(await screen.findByRole("button", { name: "Replace all data" }));
  expect(importSpy).toHaveBeenCalledWith(file, "stamp123", "sha456");
  expect(onImported).toHaveBeenCalled();
  expect(await screen.findByText(/40 features/i)).toBeInTheDocument();
  expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
  expect(screen.queryByText("Replace all data from CSV?")).not.toBeInTheDocument();
});

it("shows the conflict detail inside the modal on 409", async () => {
  mockPreview();
  vi.spyOn(client, "importCsv").mockRejectedValue(
    new ConflictError("Data changed since preview — run the preview again"),
  );
  render(<ImportButton onImported={() => {}} />);
  await openModal();
  await userEvent.click(await screen.findByRole("button", { name: "Replace all data" }));
  expect(
    await screen.findByText("Data changed since preview — run the preview again"),
  ).toBeInTheDocument();
  expect(screen.getByText("Replace all data from CSV?")).toBeInTheDocument();
});

it("reports preview failures in the status line", async () => {
  vi.spyOn(client, "previewImport").mockRejectedValue(new Error("400 Bad Request: nope"));
  render(<ImportButton onImported={() => {}} />);
  await openModal();
  expect(await screen.findByText(/Import failed: 400 Bad Request/)).toBeInTheDocument();
  expect(screen.queryByText("Replace all data from CSV?")).not.toBeInTheDocument();
});
