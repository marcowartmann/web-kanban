import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { BackupConfig } from "../../types";
import BackupSection from "./BackupSection";

afterEach(() => vi.restoreAllMocks());

const cfg: BackupConfig = {
  sftp_host: "sftp", sftp_port: 22, sftp_username: "kanban", remote_dir: "upload",
  include_db: true, include_snapshots: true, schedule_frequency: "daily",
  schedule_day_of_week: 0, schedule_time: "02:00", enabled: true, has_password: true,
};

it("loads config, masks the password, and runs a backup", async () => {
  vi.spyOn(client, "getBackupConfig").mockResolvedValue(cfg);
  vi.spyOn(client, "getBackupRuns").mockResolvedValue([]);
  const run = vi.spyOn(client, "runBackup").mockResolvedValue({
    id: 1, started_at: "2026-07-04T00:00:00Z", finished_at: "2026-07-04T00:00:01Z",
    trigger: "manual", status: "success", db_file: "db.gz", snapshots_file: null, message: "ok",
  });
  render(<BackupSection />);
  expect(await screen.findByDisplayValue("sftp")).toBeInTheDocument();
  expect(screen.getByLabelText(/sftp password/i)).toHaveValue("");
  expect(screen.getByText(/password is set/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /run now/i }));
  await waitFor(() => expect(run).toHaveBeenCalled());
  expect(await screen.findByText(/success/i)).toBeInTheDocument();
});
