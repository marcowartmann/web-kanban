import type { ReactNode } from "react";

/** In-view secondary navigation: the underline-tab idiom. */
export default function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: string; label: ReactNode }[];
  active: string | null;
  onSelect: (k: string) => void;
}) {
  return (
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-gray-200 bg-surface px-6">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === active}
          onClick={() => onSelect(t.key)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            t.key === active
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
