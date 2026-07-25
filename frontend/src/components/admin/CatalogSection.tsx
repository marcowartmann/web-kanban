import { useCallback, useEffect, useState } from "react";
import {
  createArt,
  createProduct,
  deleteArt,
  deleteProduct,
  getArts,
  getProducts,
  getTeams,
  updateProduct,
} from "../../api/client";
import type { Art, Product, Team } from "../../types";
import ConfirmDialog from "../ConfirmDialog";
import PlainSelect from "../PlainSelect";
import { btnDangerGhost, btnSecondary, captionClass, inputClass } from "../ui";

export default function CatalogSection() {
  const [arts, setArts] = useState<Art[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [newArt, setNewArt] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [newProductArt, setNewProductArt] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "art" | "product"; id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, p, t] = await Promise.all([getArts(), getProducts(), getTeams()]);
    setArts(a);
    setProducts(p);
    setTeams(t);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  };

  const addArt = () =>
    run(async () => {
      if (newArt.trim()) await createArt(newArt.trim());
      setNewArt("");
    });

  const addProduct = () =>
    run(async () => {
      const art = arts.find((a) => a.name === newProductArt);
      if (newProduct.trim() && art) {
        await createProduct({ name: newProduct.trim(), art_id: art.id });
      }
      setNewProduct("");
    });

  const linkTeam = (product: Product, teamName: string | null) =>
    run(() =>
      updateProduct(product.id, {
        team_id: teamName ? teams.find((t) => t.name === teamName)?.id ?? null : null,
      }),
    );

  const changeArt = (product: Product, artName: string | null) => {
    const art = arts.find((a) => a.name === artName);
    if (art) void run(() => updateProduct(product.id, { art_id: art.id }));
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">ARTs</h2>
        <ul className="mb-3 flex flex-col gap-1.5">
          {arts.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-sm">
              <span className="text-gray-800">{a.name}</span>
              <button
                aria-label={`Delete ${a.name}`}
                onClick={() => setConfirm({ kind: "art", id: a.id, name: a.name })}
                className={btnDangerGhost}
              >
                Delete
              </button>
            </li>
          ))}
          {arts.length === 0 && <li className="text-sm text-gray-400">No ARTs yet.</li>}
        </ul>
        <div className="flex items-center gap-2">
          <input
            placeholder="New ART name"
            value={newArt}
            onChange={(e) => setNewArt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addArt()}
            className={inputClass}
          />
          <button onClick={() => void addArt()} className={btnSecondary}>
            Add ART
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Products</h2>
        <ul className="mb-3 flex flex-col gap-2">
          {products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="min-w-32 font-medium text-gray-800">{p.name}</span>
              <div className="flex items-center gap-1.5">
                <span className={captionClass}>ART</span>
                <PlainSelect
                  ariaLabel={`ART for ${p.name}`}
                  value={p.art_name}
                  options={arts.map((a) => a.name)}
                  onChange={(v) => changeArt(p, v)}
                  clearable={false}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className={captionClass}>Team</span>
                <PlainSelect
                  ariaLabel={`Team for ${p.name}`}
                  value={p.team_name}
                  options={teams
                    .filter((t) => t.id === p.team_id || !products.some((q) => q.team_id === t.id))
                    .map((t) => t.name)}
                  onChange={(v) => linkTeam(p, v)}
                />
              </div>
              <span className="ml-auto text-xs text-gray-400">{p.service_count} services</span>
              <button
                aria-label={`Delete ${p.name}`}
                onClick={() => setConfirm({ kind: "product", id: p.id, name: p.name })}
                className={btnDangerGhost}
              >
                Delete
              </button>
            </li>
          ))}
          {products.length === 0 && <li className="text-sm text-gray-400">No products yet.</li>}
        </ul>
        <div className="flex items-center gap-2">
          <input
            placeholder="New product name"
            value={newProduct}
            onChange={(e) => setNewProduct(e.target.value)}
            className={inputClass}
          />
          <PlainSelect
            ariaLabel="ART for new product"
            value={newProductArt}
            options={arts.map((a) => a.name)}
            onChange={setNewProductArt}
            placeholder="ART…"
            clearable={false}
          />
          <button onClick={() => void addProduct()} className={btnSecondary}>
            Add product
          </button>
        </div>
      </section>

      {confirm && (
        <ConfirmDialog
          title={`Delete ${confirm.kind === "art" ? "ART" : "product"}`}
          message={`Delete “${confirm.name}”? Linked ${
            confirm.kind === "art" ? "products" : "services"
          } will block this.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            const { kind, id } = confirm;
            setConfirm(null);
            await run(() => (kind === "art" ? deleteArt(id) : deleteProduct(id)));
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
