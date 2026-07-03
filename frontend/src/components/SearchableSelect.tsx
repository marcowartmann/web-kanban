import { useEffect, useRef, useState } from "react";
import { popoverClass } from "./ui";

export default function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Search…",
  ariaLabel,
}: {
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? "");
  const ref = useRef<HTMLDivElement>(null);

  // While closed, the input mirrors the committed value (strict: discards typing).
  useEffect(() => {
    if (!open) setQuery(value ?? "");
  }, [value, open]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const filtered = open
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  const commit = (name: string) => {
    onChange(name);
    setQuery(name);
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1">
        <input
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 transition placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        {value && (
          <button
            aria-label={ariaLabel ? `Clear ${ariaLabel}` : "Clear"}
            onClick={clear}
            className="shrink-0 rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <ul className={`absolute z-10 mt-1 max-h-48 w-full overflow-auto ${popoverClass}`}>
          {filtered.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-gray-400">No matches</li>
          )}
          {filtered.map((o) => {
            const selected = o === value;
            return (
              <li key={o}>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(o);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition ${
                    selected ? "bg-blue-50 font-medium text-blue-700" : "text-gray-700 hover:bg-gray-50"
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
