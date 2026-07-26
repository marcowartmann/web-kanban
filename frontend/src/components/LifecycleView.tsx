import { useEffect, useMemo, useState } from "react";
import { getLifecycle } from "../api/client";
import PageHeader from "../shell/PageHeader";
import type { Component } from "../types";
import FilterSelect from "./FilterSelect";
import RiskBadge from "./RiskBadge";

export default function LifecycleView() {
  const [rows, setRows] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<string | null>(null);
  const [onlyAtRisk, setOnlyAtRisk] = useState(false);

  useEffect(() => {
    void getLifecycle().then(setRows).finally(() => setLoading(false));
  }, []);

  const productNames = useMemo(
    () => [...new Set(rows.map((r) => r.product_name).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (product && r.product_name !== product) return false;
        if (onlyAtRisk && r.risk === "ok") return false;
        return true;
      }),
    [rows, product, onlyAtRisk],
  );

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm font-medium transition ${
      active ? "border-blue-600 bg-blue-600 text-white shadow-xs" : "border-gray-200 bg-surface text-gray-600 hover:bg-gray-50"
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Lifecycle" />
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-surface px-6 py-3">
        <FilterSelect
          label="Product"
          value={product ?? undefined}
          options={productNames}
          onChange={(v) => setProduct(v ?? null)}
        />
        <button onClick={() => setOnlyAtRisk((v) => !v)} className={pill(onlyAtRisk)}>
          Only at risk
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-8 text-sm text-gray-400">
            No components yet. Add them on a product's Components tab.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2 border-b border-gray-100">Component</th>
                <th className="px-3 py-2 border-b border-gray-100">Product</th>
                <th className="px-3 py-2 border-b border-gray-100">Vendor</th>
                <th className="px-3 py-2 border-b border-gray-100">Stage</th>
                <th className="px-3 py-2 border-b border-gray-100">End of Sale</th>
                <th className="px-3 py-2 border-b border-gray-100">End of Support</th>
                <th className="px-3 py-2 border-b border-gray-100">End of Life</th>
                <th className="px-3 py-2 border-b border-gray-100">Risk</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 border-b border-gray-100">
                    <div className="font-medium text-gray-800">{c.name}</div>
                    {c.model && <div className="text-xs text-gray-400">{c.model}</div>}
                  </td>
                  <td className="px-3 py-2 border-b border-gray-100">{c.product_name ?? "—"}</td>
                  <td className="px-3 py-2 border-b border-gray-100">{c.vendor_name ?? "—"}</td>
                  <td className="px-3 py-2 border-b border-gray-100">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {c.lifecycle_stage}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b border-gray-100">{c.end_of_sale ?? "—"}</td>
                  <td className="px-3 py-2 border-b border-gray-100">{c.end_of_support ?? "—"}</td>
                  <td className="px-3 py-2 border-b border-gray-100">{c.end_of_life ?? "—"}</td>
                  <td className="px-3 py-2 border-b border-gray-100">
                    {c.risk === "ok" ? "—" : <RiskBadge risk={c.risk} />}
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
