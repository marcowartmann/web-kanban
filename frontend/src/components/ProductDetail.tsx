import { useCallback, useEffect, useState } from "react";
import { createService, getProductServices } from "../api/client";
import type { CatalogService, LifecycleState, Product } from "../types";
import ServiceDrawer from "./ServiceDrawer";
import { btnPrimary, btnSecondary, inputClass } from "./ui";

const BADGE: Record<LifecycleState, string> = {
  planned: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  deprecated: "bg-amber-50 text-amber-700",
  retired: "bg-gray-100 text-gray-500",
};

function ServiceNode({
  service,
  depth,
  onOpen,
}: {
  service: CatalogService;
  depth: number;
  onOpen: (s: CatalogService) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginLeft: depth ? 20 : 0 }}>
      <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-gray-200 bg-surface px-3 py-2">
        {service.children.length > 0 && (
          <button
            aria-label={`${open ? "Collapse" : "Expand"} ${service.name}`}
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            {open ? "▾" : "▸"}
          </button>
        )}
        <button onClick={() => onOpen(service)} className="flex-1 text-left text-sm font-medium text-gray-800">
          {service.name}
        </button>
        {service.owner_name && <span className="text-xs text-gray-400">{service.owner_name}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[service.lifecycle_state]}`}>
          {service.lifecycle_state}
        </span>
      </div>
      {open &&
        service.children.map((c) => (
          <ServiceNode key={c.id} service={c} depth={depth + 1} onOpen={onOpen} />
        ))}
    </div>
  );
}

export default function ProductDetail({
  product,
  onBack,
}: {
  product: Product;
  onBack: () => void;
}) {
  const [tree, setTree] = useState<CatalogService[]>([]);
  const [drawer, setDrawer] = useState<CatalogService | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => getProductServices(product.id).then(setTree),
    [product.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const addService = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      await createService({ name: newName.trim(), product_id: product.id });
      setNewName("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create service");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
          ← Back to products
        </button>
        <div className="mt-2 mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{product.name}</h1>
            <p className="text-sm text-gray-500">
              {product.art_name}
              {product.team_name ? ` · Team ${product.team_name}` : ""}
            </p>
            {product.description && (
              <p className="mt-1 max-w-2xl text-sm text-gray-600">{product.description}</p>
            )}
          </div>
          <button onClick={() => setAdding((v) => !v)} className={btnSecondary}>
            Add service
          </button>
        </div>
        {adding && (
          <div className="mb-4 flex max-w-md items-center gap-2">
            <input
              autoFocus
              placeholder="Service name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addService()}
              className={inputClass}
            />
            <button onClick={() => void addService()} className={btnPrimary}>
              Create
            </button>
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {tree.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No services yet.</div>
        ) : (
          tree.map((s) => <ServiceNode key={s.id} service={s} depth={0} onOpen={setDrawer} />)
        )}
      </div>
      {drawer && (
        <ServiceDrawer
          key={drawer.id}
          service={drawer}
          productId={product.id}
          onClose={() => setDrawer(null)}
          onChanged={async () => {
            await load();
          }}
        />
      )}
    </div>
  );
}
