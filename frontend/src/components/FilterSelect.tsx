import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { faChevronDown, faCheck } from "../icons";

// A clean, non-native single-select dropdown for the filter bar.
export default function FilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
  allowAll = true,
}: {
  label: string;
  value: string | undefined;
  options: string[];
  onChange: (value: string | undefined) => void;
  allLabel?: string;
  // When false, omit the "All" entry — the control is a required selector
  // (e.g. Planning Interval) and always shows a concrete value.
  allowAll?: boolean;
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

  const active = allowAll && value !== undefined;

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
            : "border-gray-200 bg-surface text-gray-700 hover:bg-gray-50"
        }`}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {label}
        </span>
        <span className="font-medium">{value ?? allLabel}</span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`text-xs text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 z-20 mt-2 max-h-60 min-w-44 overflow-auto rounded-xl border border-gray-200 bg-surface p-1 shadow-lg ring-1 ring-black/5"
        >
          {allowAll && (
            <Option selected={value === undefined} onSelect={() => select(undefined)}>
              <span className="text-gray-400">{allLabel}</span>
            </Option>
          )}
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
          <FontAwesomeIcon icon={faCheck} className="shrink-0 text-xs" />
        )}
      </button>
    </li>
  );
}
