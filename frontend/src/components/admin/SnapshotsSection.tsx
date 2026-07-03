import { useEffect, useState } from "react";
import { API, listSnapshots, restoreSnapshot } from "../../api/client";
import type { SnapshotInfo } from "../../types";
import ConfirmDialog from "../ConfirmDialog";
import AdminCard, { adminEmptyClass } from "./AdminCard";

export default function SnapshotsSection({ onChanged }: { onChanged: () => void }) {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  const reload = () => void listSnapshots().then(setSnapshots);
  useEffect(reload, []);

  const restore = async (name: string) => {
    setError(null);
    setStatus(null);
    setRestoring(true);
    try {
      const r = await restoreSnapshot(name);
      setStatus(
        `Restored ${r.items} items, ${r.comments} comments, ${r.links} links` +
          (r.warnings.length ? ` — ${r.warnings.length} warning(s)` : ""),
      );
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore the snapshot.");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <AdminCard
      title="Import snapshots"
      icon="🗂️"
      accent="bg-emerald-50 text-emerald-600"
      count={snapshots.length}
    >
      {status && <p className="mb-2 text-xs text-emerald-700">{status}</p>}
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      {snapshots.length === 0 ? (
        <p className={adminEmptyClass}>
          No snapshots yet — one is created automatically before every import.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-700">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 pr-3 font-medium">By</th>
                <th className="py-2 pr-3 font-medium">Items</th>
                <th className="py-2 pr-3 font-medium">Comments</th>
                <th className="py-2 pr-3 font-medium">Links</th>
                <th className="py-2 font-medium" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.name} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-3">{new Date(s.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-3">{s.actor}</td>
                  <td className="py-2 pr-3">{s.items}</td>
                  <td className="py-2 pr-3">{s.comments}</td>
                  <td className="py-2 pr-3">{s.links}</td>
                  <td className="py-2">
                    <span className="flex items-center justify-end gap-3">
                      <a
                        href={`${API}/import/snapshots/${encodeURIComponent(s.name)}/download`}
                        download={s.name}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Download
                      </a>
                      <button
                        onClick={() => setConfirmRestore(s.name)}
                        aria-label={`restore snapshot ${s.name}`}
                        disabled={restoring}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Restore
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmRestore && (
        <ConfirmDialog
          title="Restore snapshot?"
          message={`${confirmRestore}\nCurrent data is snapshotted first, then replaced.`}
          confirmLabel="Restore"
          onConfirm={() => {
            const name = confirmRestore;
            setConfirmRestore(null);
            void restore(name);
          }}
          onClose={() => setConfirmRestore(null)}
        />
      )}
    </AdminCard>
  );
}
