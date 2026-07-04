import { useEffect, useRef, useState } from "react";

// A clean, non-native single-select dropdown for the filter bar.
export default function FilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
}: {
  label: string;
  value: string | undefined;
  options: string[];
  onChange: (value: string | undefined) => void;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const select = (v: string | undefined) => {
    onChange(v);
    setOpen(false);
  };

  const active = value !== undefined;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm shadow-xs transition focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
          active
            ? "border-blue-300 bg-blue-50 text-blue-700"
            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
        }`}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {label}
        </span>
        <span className="font-medium">{value ?? allLabel}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 z-20 mt-2 max-h-60 min-w-44 overflow-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg ring-1 ring-black/5"
        >
          <Option selected={value === undefined} onSelect={() => select(undefined)}>
            <span className="text-gray-400">{allLabel}</span>
          </Option>
          {options.map((o) => (
            <Option key={o} selected={value === o} onSelect={() => select(o)}>
              {o}
            </Option>
          ))}
        </ul>
      )}
    </div>
  );
}

function Option({
  children,
  selected,
  onSelect,
}: {
  children: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition ${
          selected ? "bg-blue-50 font-medium text-blue-700" : "text-gray-700 hover:bg-gray-50"
        }`}
      >
        <span className="truncate">{children}</span>
        {selected && (
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4 shrink-0">
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-7.2 7.2a1 1 0 01-1.42 0l-3.3-3.3a1 1 0 011.42-1.42l2.59 2.6 6.49-6.49a1 1 0 011.42 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
    </li>
  );
}
