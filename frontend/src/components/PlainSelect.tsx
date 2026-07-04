import { useEffect, useRef, useState } from "react";
import { popoverClass } from "./ui";

/** A plain dropdown with the same value/options/onChange contract as
 *  SearchableSelect, but no search box — for short, fixed option lists.
 *
 *  Fully Tailwind-styled (trigger + option list) so both the closed control
 *  and the open menu match the app's look in light and dark themes, unlike a
 *  native <select> whose option list is OS-rendered and unstyleable. */
export default function PlainSelect({
  value,
  options,
  onChange,
  placeholder = "Select…",
  ariaLabel,
}: {
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-surface px-2.5 py-1.5 text-left text-sm transition focus:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
          value ? "text-gray-900" : "text-gray-400"
        }`}
      >
        <span className="truncate">{value ?? placeholder}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-gray-400"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className={`absolute z-10 mt-1 max-h-48 w-full overflow-auto ${popoverClass}`}
        >
          {options.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-gray-400">No options</li>
          )}
          {options.map((o) => {
            const selected = o === value;
            return (
              <li key={o}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => commit(o)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition ${
                    selected
                      ? "bg-blue-50 font-medium text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className="truncate">{o}</span>
                  {selected && (
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0"
                    >
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
          })}
        </ul>
      )}
    </div>
  );
}
