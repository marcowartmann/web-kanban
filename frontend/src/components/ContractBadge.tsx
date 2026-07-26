import type { ContractStatus } from "../types";

const STYLE: Record<Exclude<ContractStatus, "active">, string> = {
  expiring: "bg-amber-50 text-amber-700",
  expired: "bg-red-50 text-red-700",
};

/** Support-contract status pill; renders nothing when the status is "active". */
export default function ContractBadge({ status }: { status: ContractStatus }) {
  if (status === "active") return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {status}
    </span>
  );
}
