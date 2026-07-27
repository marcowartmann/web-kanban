import { useCallback, useEffect, useState } from "react";
import {
  createArt,
  createProduct,
  deleteArt,
  deleteProduct,
  getArts,
  getProducts,
  getTeams,
  updateArt,
  updateProduct,
} from "../../api/client";
import type { Art, Product, Team } from "../../types";
import Banner from "../Banner";
import ConfirmDialog from "../ConfirmDialog";
import PlainSelect from "../PlainSelect";
import { btnDangerGhost, btnGhost, btnSecondary, captionClass, inputClass } from "../ui";
import { adminCardClass } from "./AdminCard";

export default function CatalogSection() {
  const [arts, setArts] = useState<Art[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [newArt, setNewArt] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [newProductArt, setNewProductArt] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "art" | "product"; id: number; name: string } | null>(null);
  const [editing, setEditing] = useState<{ kind: "art" | "product"; id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, p, t] = await Promise.all([getArts(), getProducts(), getTeams()]);
    setArts(a);
    setProducts(p);
    setTeams(t);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load catalog"));
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return;
    }
    try {
      await load();
    } catch {
      setError("Saved, but refreshing the list failed — reload the page.");
    }
  };

  const addArt = () =>
    run(async () => {
      if (newArt.trim()) await createArt(newArt.trim());
      setNewArt("");
    });

  const addProduct = () =>
    run(async () => {
      const name = newProduct.trim();
      if (!name) return;
      const art = arts.find((a) => a.name === newProductArt);
      // Keep the typed name on failure — silently discarding input is worse
      // than making the user pick the missing ART.
      if (!art) throw new Error("Select an ART for the new product");
      await createProduct({ name, art_id: art.id });
      setNewProduct("");
    });

  const commitRename = () =>
    run(async () => {
      if (!editing) return;
      const name = editing.name.trim();
      if (name) {
        if (editing.kind === "art") await updateArt(editing.id, { name });
        else await updateProduct(editing.id, { name });
      }
      setEditing(null);
    });

  const renameField = (kind: "art" | "product", id: number, originalName: string) => (
    <input
      autoFocus
      aria-label={`Rename ${originalName}`}
      value={editing?.name ?? ""}
      onChange={(e) => setEditing({ kind, id, name: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === "Enter") void commitRename();
        if (e.key === "Escape") setEditing(null);
      }}
      className={inputClass}
    />
  );

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
      {error && <Banner tone="error">{error}</Banner>}

      <section className={adminCardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">ARTs</h2>
        <ul className="mb-3 flex flex-col gap-1.5">
          {arts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-sm">
              {editing?.kind === "art" && editing.id === a.id ? (
                renameField("art", a.id, a.name)
              ) : (
                <span className="text-gray-800">{a.name}</span>
              )}
              <button
                aria-label={`Rename ${a.name}`}
                onClick={() => setEditing({ kind: "art", id: a.id, name: a.name })}
                className={`ml-auto ${btnGhost}`}
              >
                Rename
              </button>
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

      <section className={adminCardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Products</h2>
        <ul className="mb-3 flex flex-col gap-2">
          {products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              {editing?.kind === "product" && editing.id === p.id ? (
                <span className="min-w-48">{renameField("product", p.id, p.name)}</span>
              ) : (
                <span className="min-w-32 font-medium text-gray-800">{p.name}</span>
              )}
              <button
                aria-label={`Rename ${p.name}`}
                onClick={() => setEditing({ kind: "product", id: p.id, name: p.name })}
                className={btnGhost}
              >
                Rename
              </button>
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
