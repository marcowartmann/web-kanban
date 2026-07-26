import { useEffect, useMemo, useState } from "react";
import { getContracts } from "../api/client";
import PageHeader from "../shell/PageHeader";
import type { SupportContract } from "../types";
import Banner from "./Banner";
import ContractBadge from "./ContractBadge";
import ContractDrawer from "./ContractDrawer";
import EmptyState from "./EmptyState";
import FilterSelect from "./FilterSelect";
import { SkeletonRows } from "./Skeleton";
import TogglePill from "./TogglePill";
import { tdClass, thClass } from "./ui";

export default function ContractsView() {
  const [rows, setRows] = useState<SupportContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [editing, setEditing] = useState<SupportContract | null>(null);

  const reload = () => getContracts().then(setRows);

  useEffect(() => {
    void getContracts()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const productNames = useMemo(
    () => [...new Set(rows.map((r) => r.product_name).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (product && r.product_name !== product) return false;
        if (onlyExpiring && r.status === "active") return false;
        return true;
      }),
    [rows, product, onlyExpiring],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Contracts" />
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-surface px-6 py-3">
        <FilterSelect
          label="Product"
          value={product ?? undefined}
          options={productNames}
          onChange={(v) => setProduct(v ?? null)}
        />
        <TogglePill active={onlyExpiring} onChange={setOnlyExpiring}>
          Only expiring or expired
        </TogglePill>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-3">
            <Banner tone="error">{error}</Banner>
          </div>
        )}
        {loading ? (
          <SkeletonRows />
        ) : filtered.length === 0 ? (
          <EmptyState>No contracts yet. Add them on a product's Contracts tab.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className={thClass}>Contract</th>
                <th className={thClass}>Product</th>
                <th className={thClass}>Vendor</th>
                <th className={thClass}>End date</th>
                <th className={thClass}>Status</th>
                <th className={`${thClass} text-right`}>Yearly cost</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => setEditing(c)} className="cursor-pointer transition hover:bg-gray-50">
                  <td className={tdClass}>
                    <button
                      className="text-left font-medium text-gray-800 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(c);
                      }}
                    >
                      {c.name}
                    </button>
                  </td>
                  <td className={tdClass}>{c.product_name ?? "—"}</td>
                  <td className={tdClass}>{c.vendor_name ?? "—"}</td>
                  <td className={tdClass}>{c.end_date ?? "—"}</td>
                  <td className={tdClass}>
                    {c.status === "active" ? "—" : <ContractBadge status={c.status} />}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>
                    {c.yearly_cost != null ? c.yearly_cost.toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <ContractDrawer
          contract={editing}
          productId={editing.product_id}
          onClose={() => setEditing(null)}
          onChanged={async () => {
            await reload();
          }}
        />
      )}
    </div>
  );
}
