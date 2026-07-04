import { useEffect, useState } from "react";
import type { ItemKind } from "../types";
import FilterSelect from "./FilterSelect";

export interface BoardFilters {
  planning_interval?: string;
  leading_team?: string;
  assignee?: string;
  container?: string;
  department?: string;
  kinds?: ItemKind[];
  q?: string;
}

export default function Toolbar({
  filters,
  onChange,
  planningIntervals,
  teams,
  assignees,
  containerNames = [],
  departmentNames = [],
  kindOptions,
}: {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  planningIntervals: string[];
  teams: string[];
  assignees: string[];
  containerNames?: string[];
  departmentNames?: string[];
  kindOptions: ItemKind[];
}) {
  const [searchValue, setSearchValue] = useState(filters.q ?? "");

  useEffect(() => {
    setSearchValue(filters.q ?? "");
  }, [filters.q]);

  const set = (patch: Partial<BoardFilters>) =>
    onChange({ ...filters, ...patch });

  const toggleKind = (kind: ItemKind) => {
    const current = filters.kinds ?? [];
    const next = current.includes(kind)
      ? current.filter((k) => k !== kind)
      : [...current, kind];
    set({ kinds: next });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value);
    set({ q: value });
  };

  const hasActive =
    !!filters.q ||
    !!filters.planning_interval ||
    !!filters.leading_team ||
    !!filters.assignee ||
    !!filters.container ||
    !!filters.department ||
    !!filters.kinds?.length;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-surface px-6 py-3">
      <div className="relative">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        >
          <circle cx="9" cy="9" r="6" />
          <path strokeLinecap="round" d="M14.5 14.5L18 18" />
        </svg>
        <input
          placeholder="Search title…"
          value={searchValue}
          onChange={handleSearchChange}
          className="w-56 rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-9 pr-3 text-sm text-gray-700 transition placeholder:text-gray-400 focus:border-blue-300 focus:bg-surface focus:outline-hidden focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <FilterSelect
        label="Planning Interval"
        value={filters.planning_interval}
        options={planningIntervals}
        onChange={(v) => set({ planning_interval: v })}
      />
      <FilterSelect
        label="Team"
        value={filters.leading_team}
        options={teams}
        onChange={(v) => set({ leading_team: v })}
      />
      <FilterSelect
        label="Assignee"
        value={filters.assignee}
        options={assignees}
        onChange={(v) => set({ assignee: v })}
      />
      <FilterSelect
        label="Container"
        value={filters.container}
        options={containerNames}
        onChange={(v) => set({ container: v })}
      />
      <FilterSelect
        label="Department"
        value={filters.department}
        options={departmentNames}
        onChange={(v) => set({ department: v })}
      />

      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Kind
        </span>
        {kindOptions.map((kind) => {
          const active = (filters.kinds ?? []).includes(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={active}
              onClick={() => toggleKind(kind)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
                active
                  ? "border-blue-600 bg-blue-600 text-white shadow-xs"
                  : "border-gray-200 bg-surface text-gray-600 hover:bg-gray-50"
              }`}
            >
              {kind.charAt(0).toUpperCase() + kind.slice(1)}
            </button>
          );
        })}
      </div>

      {hasActive && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
          Clear all
        </button>
      )}
    </div>
  );
}
