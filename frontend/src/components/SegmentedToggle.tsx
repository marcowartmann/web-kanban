import { pillClass } from "./TogglePill";

/** Exclusive pill group (radiogroup semantics). */
export default function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex items-center gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={pillClass(value === o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
