import type { ReactNode } from "react";

export type BadgeTone = "gray" | "blue" | "emerald" | "amber" | "red" | "violet" | "indigo" | "sky";

// -50/-700 is the dark-safe pairing: every -50 tint is remapped in index.css.
const TONE: Record<BadgeTone, string> = {
  gray: "bg-gray-100 text-gray-600",
  blue: "bg-blue-50 text-blue-700",
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  violet: "bg-violet-50 text-violet-700",
  indigo: "bg-indigo-50 text-indigo-700",
  sky: "bg-sky-50 text-sky-700",
};

/** The one status/kind chip. Strict shape: soft rounded-full pill. */
export default function Badge({
  tone,
  strike = false,
  children,
}: {
  tone: BadgeTone;
  strike?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
        strike ? "bg-gray-100 text-gray-400 line-through" : TONE[tone]
      }`}
    >
      {children}
    </span>
  );
}
