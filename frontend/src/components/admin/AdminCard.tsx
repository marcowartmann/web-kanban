import type { ReactNode } from "react";
import { inputClass } from "../ui";

/** Shared modern styling tokens for the Admin sections, so the cards, inputs,
 *  and buttons stay visually consistent across Teams / Members / Planning
 *  Intervals / Capacity. App-wide tokens live in components/ui.ts; the admin
 *  variants below are deliberate size/layout departures from those. */
export const adminCardClass =
  "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm ring-1 ring-black/5";

export const adminInputClass = inputClass;

export const adminAddButtonClass =
  "shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200";

export const adminRowClass =
  "group flex items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2 text-sm text-gray-700 transition hover:border-gray-200 hover:bg-gray-50";

export const adminRemoveButtonClass =
  "shrink-0 rounded-md p-1 text-sm leading-none text-gray-300 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-100";

export const adminEmptyClass = "px-3 py-6 text-center text-sm text-gray-400";

/** A modern Admin panel: rounded card with an accent icon chip, title, and an
 *  optional count pill. */
export default function AdminCard({
  title,
  icon,
  accent = "bg-gray-100 text-gray-600",
  count,
  children,
}: {
  title: string;
  icon?: ReactNode;
  accent?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className={`flex flex-col ${adminCardClass}`}>
      <header className="mb-4 flex items-center gap-2.5">
        {icon != null && (
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-base ${accent}`}
            aria-hidden
          >
            {icon}
          </span>
        )}
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {count != null && (
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            {count}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}
