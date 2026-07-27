import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { faCheck, faXmark } from "../icons";
import { popoverClass } from "./ui";

export default function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Search…",
  ariaLabel,
  allowCreate = false,
}: {
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  ariaLabel?: string;
  allowCreate?: boolean;
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

  const trimmedQuery = query.trim();
  const showCreate =
    allowCreate &&
    trimmedQuery !== "" &&
    !filtered.some((o) => o.toLowerCase() === trimmedQuery.toLowerCase());

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

  // While the popover is open, Escape closes it and must not bubble to a
  // containing DrawerShell (its document-level Escape listener would close
  // the whole drawer). When closed, do nothing — let Escape reach the drawer.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || e.key !== "Escape") return;
    e.stopPropagation();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown}>
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
          className="w-full rounded-lg border border-gray-300 bg-surface px-2.5 py-1.5 text-sm text-gray-900 transition placeholder:text-gray-400 focus:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
        />
        {value && (
          <button
            aria-label={ariaLabel ? `Clear ${ariaLabel}` : "Clear"}
            onClick={clear}
            className="shrink-0 rounded-sm p-0.5 text-xs text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        )}
      </div>
      {open && (
        <ul className={`absolute z-10 mt-1 max-h-48 w-full overflow-auto ${popoverClass}`}>
          {filtered.length === 0 && !showCreate && (
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
                  {selected && <FontAwesomeIcon icon={faCheck} className="shrink-0 text-xs" />}
                </button>
              </li>
            );
          })}
          {showCreate && (
            <li>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(trimmedQuery);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-blue-700 transition hover:bg-blue-50"
              >
                <span className="truncate">
                  Use &#8220;{trimmedQuery}&#8221;
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
