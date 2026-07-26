import type { ReactNode } from "react";

const TONE = {
  error: "bg-red-50 text-red-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
} as const;

/** Inline feedback banner. tone="error" announces via role=alert. */
export default function Banner({
  tone,
  children,
}: {
  tone: keyof typeof TONE;
  children: ReactNode;
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${TONE[tone]}`}>
      {children}
    </div>
  );
}
