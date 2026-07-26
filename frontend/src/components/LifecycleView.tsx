import { useEffect, useMemo, useState } from "react";
import { getLifecycle } from "../api/client";
import PageHeader from "../shell/PageHeader";
import type { Component } from "../types";
import Badge from "./Badge";
import Banner from "./Banner";
import ComponentDrawer from "./ComponentDrawer";
import EmptyState from "./EmptyState";
import FilterSelect from "./FilterSelect";
import RiskBadge from "./RiskBadge";
import { SkeletonRows } from "./Skeleton";
import TogglePill from "./TogglePill";
import { tdClass, thClass } from "./ui";

export default function LifecycleView() {
  const [rows, setRows] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [onlyAtRisk, setOnlyAtRisk] = useState(false);
  const [editing, setEditing] = useState<Component | null>(null);

  const reload = () => getLifecycle().then(setRows);

  useEffect(() => {
    void getLifecycle()
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
        if (onlyAtRisk && r.risk === "ok") return false;
        return true;
      }),
    [rows, product, onlyAtRisk],
  );

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
        <TogglePill active={onlyAtRisk} onChange={setOnlyAtRisk}>
          Only at risk
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
          <EmptyState>No components yet. Add them on a product's Components tab.</EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className={thClass}>Component</th>
                <th className={thClass}>Product</th>
                <th className={thClass}>Vendor</th>
                <th className={thClass}>Stage</th>
                <th className={thClass}>End of Sale</th>
                <th className={thClass}>End of Support</th>
                <th className={thClass}>End of Life</th>
                <th className={thClass}>Risk</th>
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
                    {c.model && <div className="text-xs text-gray-400">{c.model}</div>}
                  </td>
                  <td className={tdClass}>{c.product_name ?? "—"}</td>
                  <td className={tdClass}>{c.vendor_name ?? "—"}</td>
                  <td className={tdClass}>
                    <Badge tone="gray">{c.lifecycle_stage}</Badge>
                  </td>
                  <td className={tdClass}>{c.end_of_sale ?? "—"}</td>
                  <td className={tdClass}>{c.end_of_support ?? "—"}</td>
                  <td className={tdClass}>{c.end_of_life ?? "—"}</td>
                  <td className={tdClass}>{c.risk === "ok" ? "—" : <RiskBadge risk={c.risk} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <ComponentDrawer
          component={editing}
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
