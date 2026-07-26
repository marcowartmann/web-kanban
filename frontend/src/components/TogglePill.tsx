import type { ReactNode } from "react";

export const pillClass = (active: boolean) =>
  `rounded-full border px-3 py-1 text-sm font-medium transition focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
    active
      ? "border-blue-600 bg-blue-600 text-white shadow-xs"
      : "border-gray-200 bg-surface text-gray-600 hover:bg-gray-50"
  }`;

/** Single on/off filter pill. */
export default function TogglePill({
  active,
  onChange,
  children,
}: {
  active: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={() => onChange(!active)} className={pillClass(active)}>
      {children}
    </button>
  );
}
