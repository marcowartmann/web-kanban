import { useRef, useState } from "react";
import { importCsv } from "../api/client";
import type { ImportResult } from "../types";

export default function ImportButton({
  onImported,
}: {
  onImported: (result: ImportResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm("This deletes all current items and reloads from the file. Continue?")) {
      return;
    }
    try {
      const result = await importCsv(file);
      setStatus(
        `Imported ${result.features} features, ${result.stories} stories, ` +
          `${result.risks} risks` +
          (result.warnings.length ? ` — ${result.warnings.length} warning(s)` : ""),
      );
      onImported(result);
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <label className="cursor-pointer rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700">
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
    </div>
  );
}
