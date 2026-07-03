import { useRef, useState } from "react";
import { ConflictError, importCsv, previewImport } from "../api/client";
import type { ImportPreview, ImportResult } from "../types";
import { btnDanger, btnGhost, btnSecondary, modalPanelClass, overlayClass } from "./ui";

export default function ImportButton({
  onImported,
}: {
  onImported: (result: ImportResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = "";
    if (!chosen) return;
    setStatus(null);
    try {
      const p = await previewImport(chosen);
      setFile(chosen);
      setPreview(p);
      setModalError(null);
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const close = () => {
    setPreview(null);
    setFile(null);
    setModalError(null);
  };

  const confirm = async () => {
    if (!file || !preview) return;
    setBusy(true);
    setModalError(null);
    try {
      const result = await importCsv(file, preview.state_stamp, preview.file_sha256);
      close();
      setStatus(
        `Imported ${result.features} features, ${result.stories} stories, ` +
          `${result.risks} risks` +
          (result.warnings.length ? ` — ${result.warnings.length} warning(s)` : ""),
      );
      onImported(result);
    } catch (err) {
      if (err instanceof ConflictError) {
        setModalError(err.detail);
      } else {
        close();
        setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const titleLine = (list: string[], more: number) =>
    list.length ? list.join(", ") + (more > 0 ? ` … and ${more} more` : "") : null;

  return (
    <div className="flex items-center gap-3">
      <label
        className={`${btnSecondary} cursor-pointer focus-within:ring-2 focus-within:ring-blue-100`}
      >
        Import CSV
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          aria-label="Import CSV"
          onChange={onFile}
          className="hidden"
        />
      </label>
      {status && <span className="text-xs text-gray-500">{status}</span>}
      {preview && (
        <div
          className={`${overlayClass} z-50`}
          role="dialog"
          aria-label="Import preview"
          onClick={() => !busy && close()}
        >
          <div
            className={`${modalPanelClass} max-h-[80vh] max-w-lg overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900">Replace all data from CSV?</h2>
            <p className="mt-3 text-sm text-gray-700">
              {`Will be deleted: ${preview.current.features} features, ${preview.current.stories} stories, ` +
                `${preview.current.risks} risks — plus ${preview.current.comments} comments and ` +
                `${preview.current.links} links (not recoverable from CSV)`}
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {`Will be imported: ${preview.incoming.features} features, ` +
                `${preview.incoming.stories} stories, ${preview.incoming.risks} risks`}
            </p>
            {preview.incoming.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
                {preview.incoming.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {titleLine(preview.added_titles, preview.added_more) && (
              <p className="mt-2 text-xs text-gray-500">
                <span className="font-medium text-gray-700">Added: </span>
                {titleLine(preview.added_titles, preview.added_more)}
              </p>
            )}
            {titleLine(preview.removed_titles, preview.removed_more) && (
              <p className="mt-1 text-xs text-gray-500">
                <span className="font-medium text-gray-700">Removed: </span>
                {titleLine(preview.removed_titles, preview.removed_more)}
              </p>
            )}
            <p className="mt-3 text-xs text-gray-500">
              A snapshot is saved automatically before the import.
            </p>
            {modalError && <p className="mt-2 text-xs font-medium text-amber-700">{modalError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={close} disabled={busy} className={`${btnGhost} disabled:opacity-60`}>
                Cancel
              </button>
              <button onClick={confirm} disabled={busy} className={btnDanger}>
                Replace all data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
