import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { faChevronDown, faCheck } from "../icons";
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
  disabled = false,
  clearable = true,
}: {
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Show the placeholder/clear option (null). Set false for required fields. */
  clearable?: boolean;
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

  const commit = (v: string | null) => {
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
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-surface px-2.5 py-1.5 text-left text-sm transition focus:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60 ${
          value ? "text-gray-900" : "text-gray-400"
        }`}
      >
        <span className="truncate">{value ?? placeholder}</span>
        <FontAwesomeIcon icon={faChevronDown} className="shrink-0 text-xs text-gray-400" />
      </button>
      {open && (
        <ul
          role="listbox"
          className={`absolute z-10 mt-1 max-h-48 w-full overflow-auto ${popoverClass}`}
        >
          {clearable && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value == null}
                onClick={() => commit(null)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition ${
                  value == null
                    ? "bg-blue-50 font-medium text-blue-700"
                    : "text-gray-400 hover:bg-gray-50"
                }`}
              >
                <span className="truncate">{placeholder}</span>
              </button>
            </li>
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
                  {selected && <FontAwesomeIcon icon={faCheck} className="shrink-0 text-xs" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
