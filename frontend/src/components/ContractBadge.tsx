import Badge, { type BadgeTone } from "./Badge";
import type { ContractStatus } from "../types";

const TONE: Record<Exclude<ContractStatus, "active">, BadgeTone> = { expiring: "amber", expired: "red" };

/** Support-contract status pill; renders nothing when the status is "active". */
export default function ContractBadge({ status }: { status: ContractStatus }) {
  if (status === "active") return null;
  return <Badge tone={TONE[status]}>{status}</Badge>;
}
