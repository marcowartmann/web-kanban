import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ImportButton from "./ImportButton";

afterEach(() => vi.restoreAllMocks());

it("imports the chosen file after confirm and reports counts", async () => {
  const importSpy = vi.spyOn(client, "importCsv").mockResolvedValue({
    features: 40, stories: 60, risks: 8, warnings: ["w1"],
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const onImported = vi.fn();
  render(<ImportButton onImported={onImported} />);

  const file = new File(["Title\nX"], "plan.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText(/import csv/i), file);

  expect(importSpy).toHaveBeenCalledWith(file, "", "");
  expect(onImported).toHaveBeenCalled();
  expect(await screen.findByText(/40 features/i)).toBeInTheDocument();
  expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
});

it("aborts when the confirm dialog is cancelled", async () => {
  const importSpy = vi.spyOn(client, "importCsv").mockResolvedValue({
    features: 0, stories: 0, risks: 0, warnings: [],
  });
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<ImportButton onImported={() => {}} />);
  const file = new File(["x"], "plan.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText(/import csv/i), file);
  expect(importSpy).not.toHaveBeenCalled();
});
