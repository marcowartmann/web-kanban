import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import {
  getBackupConfig,
  getBackupRuns,
  runBackup,
  saveBackupConfig,
  testBackup,
} from "../../api/client";
import { faCloudArrowUp } from "../../icons";
import type { BackupConfig, BackupRun } from "../../types";
import PlainSelect from "../PlainSelect";
import { btnPrimary, btnSecondary } from "../ui";
import { adminCardClass, adminInputClass } from "./AdminCard";

const FREQ = [
  { value: "disabled", label: "Disabled" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
] as const;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Freq = BackupConfig["schedule_frequency"];

export default function BackupSection() {
  const [cfg, setCfg] = useState<BackupConfig | null>(null);
  const [password, setPassword] = useState("");
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getBackupConfig().then(setCfg);
    void getBackupRuns().then(setRuns);
  }, []);

  if (!cfg) return <div className={adminCardClass}>Loading…</div>;

  const patch = (p: Partial<BackupConfig>) => setCfg({ ...cfg, ...p });
  const field = (label: string, node: React.ReactNode) => (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {node}
    </label>
  );

  const save = async () => {
    setBusy(true); setError(null); setStatus(null);
    try {
      const { has_password: _hp, ...rest } = cfg;
      const saved = await saveBackupConfig({ ...rest, password: password || undefined });
      setCfg(saved);
      setPassword("");
      setStatus("Configuration saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true); setError(null); setStatus(null);
    try {
      await testBackup({
        sftp_host: cfg.sftp_host ?? undefined,
        sftp_port: cfg.sftp_port,
        sftp_username: cfg.sftp_username ?? undefined,
        password: password || undefined,
        remote_dir: cfg.remote_dir,
      });
      setStatus("SFTP connection OK.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true); setError(null); setStatus(null);
    try {
      const r = await runBackup();
      setRuns((rs) => [r, ...rs]);
      setStatus(r.status === "success" ? `Backup succeeded — ${r.message}` : `Backup failed — ${r.message}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`flex flex-col ${adminCardClass}`}>
      <header className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-base text-sky-600" aria-hidden>
          <FontAwesomeIcon icon={faCloudArrowUp} />
        </span>
        <h2 className="text-sm font-semibold text-gray-900">Backup to SFTP</h2>
      </header>

      <div className="grid gap-x-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">SFTP server</h3>
          {field("Host", <input aria-label="SFTP host" value={cfg.sftp_host ?? ""} onChange={(e) => patch({ sftp_host: e.target.value })} className={`w-full ${adminInputClass}`} />)}
          {field("Port", <input aria-label="SFTP port" type="number" value={cfg.sftp_port} onChange={(e) => patch({ sftp_port: Number(e.target.value) })} className={`w-full ${adminInputClass}`} />)}
          {field("Username", <input aria-label="SFTP username" value={cfg.sftp_username ?? ""} onChange={(e) => patch({ sftp_username: e.target.value })} className={`w-full ${adminInputClass}`} />)}
          {field("Password", (
            <>
              <input aria-label="SFTP password" type="password" value={password} placeholder={cfg.has_password ? "•••••• (unchanged)" : ""} onChange={(e) => setPassword(e.target.value)} className={`w-full ${adminInputClass}`} />
              {cfg.has_password && <span className="mt-1 block text-[11px] text-gray-400">Password is set — leave blank to keep it.</span>}
            </>
          ))}
          {field("Remote directory", <input aria-label="Remote directory" value={cfg.remote_dir} onChange={(e) => patch({ remote_dir: e.target.value })} className={`w-full ${adminInputClass}`} />)}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Contents & schedule</h3>
          <label className="mb-2 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={cfg.include_db} onChange={(e) => patch({ include_db: e.target.checked })} /> Include database dump
          </label>
          <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={cfg.include_snapshots} onChange={(e) => patch({ include_snapshots: e.target.checked })} /> Include snapshots
          </label>
          <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => patch({ enabled: e.target.checked })} /> Scheduled backups enabled
          </label>
          {field("Frequency", (
            <PlainSelect
              ariaLabel="Frequency"
              value={FREQ.find((f) => f.value === cfg.schedule_frequency)?.label ?? "Disabled"}
              options={FREQ.map((f) => f.label)}
              onChange={(v) => patch({ schedule_frequency: (FREQ.find((f) => f.label === v)?.value ?? "disabled") as Freq })}
              placeholder="Disabled"
            />
          ))}
          {cfg.schedule_frequency === "weekly" && field("Day of week", (
            <PlainSelect
              ariaLabel="Day of week"
              value={DAYS[cfg.schedule_day_of_week]}
              options={DAYS}
              onChange={(v) => patch({ schedule_day_of_week: Math.max(0, DAYS.indexOf(v ?? "Monday")) })}
              placeholder="Monday"
            />
          ))}
          {cfg.schedule_frequency !== "disabled" && field("Time (UTC, HH:MM)", (
            <input aria-label="Schedule time" value={cfg.schedule_time} onChange={(e) => patch({ schedule_time: e.target.value })} className={`w-full ${adminInputClass}`} />
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={() => void save()} disabled={busy} className={btnPrimary}>Save</button>
        <button onClick={() => void test()} disabled={busy} className={btnSecondary}>Test connection</button>
        <button onClick={() => void run()} disabled={busy} className={btnSecondary}>Run now</button>
        {status && <span className="text-xs font-medium text-emerald-700">{status}</span>}
        {error && <span className="text-xs font-medium text-red-600">{error}</span>}
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-gray-400">Recent runs</h3>
      {runs.length === 0 ? (
        <p className="text-sm text-gray-400">No backups have run yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-700">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2 pr-3 font-medium">Started</th>
                <th className="py-2 pr-3 font-medium">Trigger</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Files</th>
                <th className="py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-3">{r.started_at ? new Date(r.started_at).toLocaleString() : "—"}</td>
                  <td className="py-2 pr-3">{r.trigger}</td>
                  <td className={`py-2 pr-3 font-medium ${r.status === "success" ? "text-emerald-600" : r.status === "error" ? "text-red-600" : "text-gray-500"}`}>{r.status}</td>
                  <td className="py-2 pr-3 text-xs text-gray-500">{[r.db_file, r.snapshots_file].filter(Boolean).join(", ") || "—"}</td>
                  <td className="py-2 text-xs text-gray-500">{r.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
