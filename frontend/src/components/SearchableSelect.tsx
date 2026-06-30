import { useEffect, useRef, useState } from "react";

export default function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Search…",
}: {
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  placeholder?: string;
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
          aria-expanded={open}
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
        {value && (
          <button
            aria-label="Clear assignee"
            onClick={clear}
            className="px-1 text-gray-400 hover:text-red-600"
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-gray-200 bg-white shadow">
          {filtered.length === 0 && (
            <li className="px-2 py-1 text-xs text-gray-400">No matches</li>
          )}
          {filtered.map((o) => (
            <li key={o}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(o);
                }}
                className="block w-full px-2 py-1 text-left text-sm hover:bg-blue-50"
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
