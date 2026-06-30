import { useEffect, useState } from "react";
import type { ItemKind } from "../types";

export interface BoardFilters {
  iteration?: string;
  leading_team?: string;
  assignee?: string;
  kinds?: ItemKind[];
  q?: string;
}

export default function Toolbar({
  filters,
  onChange,
  iterations,
  teams,
  assignees,
  kindOptions,
}: {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  iterations: string[];
  teams: string[];
  assignees: string[];
  kindOptions: ItemKind[];
}) {
  const [searchValue, setSearchValue] = useState(filters.q ?? "");

  useEffect(() => {
    setSearchValue(filters.q ?? "");
  }, [filters.q]);

  const set = (patch: Partial<BoardFilters>) =>
    onChange({ ...filters, ...patch });

  const toggleKind = (kind: ItemKind, checked: boolean) => {
    const current = filters.kinds ?? [];
    const next = checked
      ? [...current, kind]
      : current.filter((k) => k !== kind);
    set({ kinds: next });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value);
    set({ q: value });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-b bg-white px-6 py-3">
      <input
        placeholder="Search title…"
        value={searchValue}
        onChange={handleSearchChange}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <label className="text-xs text-gray-500">
        Iteration
        <select
          value={filters.iteration ?? ""}
          onChange={(e) => set({ iteration: e.target.value || undefined })}
          className="ml-1 rounded border border-gray-300 px-1 py-1 text-sm"
        >
          <option value="">All</option>
          {iterations.map((it) => (
            <option key={it} value={it}>{it}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-500">
        Team
        <select
          value={filters.leading_team ?? ""}
          onChange={(e) => set({ leading_team: e.target.value || undefined })}
          className="ml-1 rounded border border-gray-300 px-1 py-1 text-sm"
        >
          <option value="">All</option>
          {teams.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-500">
        Assignee
        <select
          value={filters.assignee ?? ""}
          onChange={(e) => set({ assignee: e.target.value || undefined })}
          className="ml-1 rounded border border-gray-300 px-1 py-1 text-sm"
        >
          <option value="">All</option>
          {assignees.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>
      <fieldset className="flex items-center gap-2 text-xs text-gray-500">
        <span>Kind</span>
        {kindOptions.map((kind) => (
          <label key={kind} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={(filters.kinds ?? []).includes(kind)}
              onChange={(e) => toggleKind(kind, e.target.checked)}
            />
            {kind.charAt(0).toUpperCase() + kind.slice(1)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
