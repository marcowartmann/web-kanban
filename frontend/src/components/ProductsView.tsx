import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { getProducts } from "../api/client";
import PageHeader from "../shell/PageHeader";
import type { Product } from "../types";
import EmptyState from "./EmptyState";
import { SkeletonCards } from "./Skeleton";

export default function ProductsView() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    () => getProducts().then(setProducts).finally(() => setLoading(false)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const byArt = new Map<string, Product[]>();
  for (const p of products) {
    const key = p.art_name ?? "No ART";
    const list = byArt.get(key) ?? [];
    list.push(p);
    byArt.set(key, list);
  }
  // Stable section order: alphabetical, orphans last (fetch order is not guaranteed).
  const artGroups = [...byArt.entries()].sort(([a], [b]) =>
    a === "No ART" ? 1 : b === "No ART" ? -1 : a.localeCompare(b),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Products" />
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <SkeletonCards />
        ) : products.length === 0 ? (
          <EmptyState>No products yet. Admins can create them under Admin → Catalog.</EmptyState>
        ) : (
          artGroups.map(([artName, list]) => (
            <section key={artName} className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
                {artName}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => navigate(`/products/${p.id}`)}
                    className="rounded-xl border border-gray-200 bg-surface p-4 text-left shadow-xs transition hover:border-blue-300 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900">{p.name}</span>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {p.service_count} services
                      </span>
                    </div>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-500">{p.description}</p>
                    )}
                    {p.team_name && (
                      <p className="mt-2 text-xs text-gray-400">Team: {p.team_name}</p>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
