import { useEffect, useMemo, useState } from "react";
import { getContracts } from "../api/client";
import PageHeader from "../shell/PageHeader";
import type { SupportContract } from "../types";
import Banner from "./Banner";
import ContractBadge from "./ContractBadge";
import EmptyState from "./EmptyState";
import FilterSelect from "./FilterSelect";

export default function ContractsView() {
  const [rows, setRows] = useState<SupportContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [onlyExpiring, setOnlyExpiring] = useState(false);

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

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm font-medium transition ${
      active ? "border-blue-600 bg-blue-600 text-white shadow-xs" : "border-gray-200 bg-surface text-gray-600 hover:bg-gray-50"
    }`;

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
        <button onClick={() => setOnlyExpiring((v) => !v)} className={pill(onlyExpiring)}>
          Only expiring or expired
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-3">
            <Banner tone="error">{error}</Banner>
          </div>
        )}
        {loading ? (
          <div className="text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState>No contracts yet. Add them on a product's Contracts tab.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2 border-b border-gray-100">Contract</th>
                <th className="px-3 py-2 border-b border-gray-100">Product</th>
                <th className="px-3 py-2 border-b border-gray-100">Vendor</th>
                <th className="px-3 py-2 border-b border-gray-100">End date</th>
                <th className="px-3 py-2 border-b border-gray-100">Status</th>
                <th className="px-3 py-2 border-b border-gray-100">Yearly cost</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 border-b border-gray-100">
                    <div className="font-medium text-gray-800">{c.name}</div>
                  </td>
                  <td className="px-3 py-2 border-b border-gray-100">{c.product_name ?? "—"}</td>
                  <td className="px-3 py-2 border-b border-gray-100">{c.vendor_name ?? "—"}</td>
                  <td className="px-3 py-2 border-b border-gray-100">{c.end_date ?? "—"}</td>
                  <td className="px-3 py-2 border-b border-gray-100">
                    {c.status === "active" ? "—" : <ContractBadge status={c.status} />}
                  </td>
                  <td className="px-3 py-2 border-b border-gray-100">
                    {c.yearly_cost != null ? c.yearly_cost.toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
