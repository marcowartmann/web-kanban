/** A plain native dropdown with the same value/options/onChange contract as
 *  SearchableSelect, but no search box — for short, fixed option lists. */
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
    <select
      aria-label={ariaLabel}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className="w-full rounded-lg border border-gray-300 bg-surface px-2.5 py-1.5 text-sm text-gray-900 transition focus:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
