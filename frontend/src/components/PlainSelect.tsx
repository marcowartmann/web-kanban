/** A plain native dropdown with the same value/options/onChange contract as
 *  SearchableSelect, but no search box — for short, fixed option lists.
 *  Styled to match SearchableSelect: strips the native chrome and draws a
 *  custom chevron so it reads as a modern control in both themes. */
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
  return (
    <div className="relative">
      <select
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className={`w-full appearance-none rounded-lg border border-gray-300 bg-surface py-1.5 pl-2.5 pr-8 text-sm transition focus:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
          value ? "text-gray-900" : "text-gray-400"
        }`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o} className="text-gray-900">
            {o}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}
