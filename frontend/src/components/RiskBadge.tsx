import Badge, { type BadgeTone } from "./Badge";
import type { RiskLevel } from "../types";

const TONE: Record<Exclude<RiskLevel, "ok">, BadgeTone> = { warning: "amber", danger: "red" };

/** EoL/EoS risk pill; renders nothing when the risk is "ok". */
export default function RiskBadge({ risk }: { risk: RiskLevel }) {
  if (risk === "ok") return null;
  return <Badge tone={TONE[risk]}>{risk}</Badge>;
}
