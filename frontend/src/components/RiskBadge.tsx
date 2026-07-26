import type { RiskLevel } from "../types";

const STYLE: Record<Exclude<RiskLevel, "ok">, string> = {
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
};

/** EoL/EoS risk pill; renders nothing when the risk is "ok". */
export default function RiskBadge({ risk }: { risk: RiskLevel }) {
  if (risk === "ok") return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[risk]}`}>
      {risk}
    </span>
  );
}
