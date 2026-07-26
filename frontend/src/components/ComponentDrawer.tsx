import { useEffect, useState } from "react";
import { createComponent, deleteComponent, getVendors, updateComponent } from "../api/client";
import type { Component, LifecycleStage } from "../types";
import ConfirmDialog from "./ConfirmDialog";
import PlainSelect from "./PlainSelect";
import SearchableSelect from "./SearchableSelect";
import { btnDangerGhost, btnPrimary, btnSecondary, captionClass, inputClass } from "./ui";

const STAGES: LifecycleStage[] = ["plan", "build", "operate", "phase_out", "retired"];

/** Component create/edit drawer. `component == null` is create mode (POST);
 *  otherwise edit mode (PATCH, only-changed keys). Vendor is a SearchableSelect
 *  with on-the-fly create — free text that doesn't match an existing vendor
 *  IS the get-or-create contract, offered via the "Use “…”" row. */
export default function ComponentDrawer({
  component,
  productId,
  onClose,
  onChanged,
}: {
  component: Component | null;
  productId: number;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [vendors, setVendors] = useState<string[]>([]);
  useEffect(() => {
    void getVendors().then((list) => setVendors(list.map((v) => v.name)));
  }, []);

  const [name, setName] = useState(component?.name ?? "");
  const [model, setModel] = useState(component?.model ?? "");
  const [description, setDescription] = useState(component?.description ?? "");
  const [vendorName, setVendorName] = useState<string | null>(component?.vendor_name ?? null);
  const [stage, setStage] = useState<LifecycleStage>(component?.lifecycle_stage ?? "plan");
  const [quantity, setQuantity] = useState(component?.quantity != null ? String(component.quantity) : "");
  const [eosAnnounced, setEosAnnounced] = useState(component?.eos_announced ?? "");
  const [endOfSale, setEndOfSale] = useState(component?.end_of_sale ?? "");
  const [endOfSupport, setEndOfSupport] = useState(component?.end_of_support ?? "");
  const [endOfLife, setEndOfLife] = useState(component?.end_of_life ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedQuantity = quantity.trim() === "" ? null : Number(quantity);

  const save = async () => {
    setError(null);
    try {
      if (component == null) {
        await createComponent({
          name,
          product_id: productId,
          model: model || null,
          description: description || null,
          vendor_name: vendorName,
          lifecycle_stage: stage,
          quantity: parsedQuantity,
          eos_announced: eosAnnounced || null,
          end_of_sale: endOfSale || null,
          end_of_support: endOfSupport || null,
          end_of_life: endOfLife || null,
        });
      } else {
        const changes: Parameters<typeof updateComponent>[1] = {};
        if (name !== component.name) changes.name = name;
        if (model !== (component.model ?? "")) changes.model = model || null;
        if (description !== (component.description ?? "")) changes.description = description || null;
        if (vendorName !== (component.vendor_name ?? null)) changes.vendor_name = vendorName;
        if (stage !== component.lifecycle_stage) changes.lifecycle_stage = stage;
        if (parsedQuantity !== component.quantity) changes.quantity = parsedQuantity;
        if (eosAnnounced !== (component.eos_announced ?? "")) changes.eos_announced = eosAnnounced || null;
        if (endOfSale !== (component.end_of_sale ?? "")) changes.end_of_sale = endOfSale || null;
        if (endOfSupport !== (component.end_of_support ?? "")) changes.end_of_support = endOfSupport || null;
        if (endOfLife !== (component.end_of_life ?? "")) changes.end_of_life = endOfLife || null;
        await updateComponent(component.id, changes);
      }
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const remove = async () => {
    if (!component) return;
    setError(null);
    try {
      await deleteComponent(component.id);
      await onChanged();
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      setError(e instanceof Error ? e.message : "Delete blocked");
    }
  };

  return (
    <aside
      aria-label="Component drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-[26rem] flex-col overflow-y-auto border-l border-gray-200 bg-surface p-5 shadow-2xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          {component == null ? "New component" : "Edit component"}
        </h2>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>
      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <label className={captionClass}>Name</label>
      <input
        aria-label="Component name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Model</label>
      <input
        aria-label="Model"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Description</label>
      <textarea
        aria-label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Vendor</label>
      <div className="mb-3">
        <SearchableSelect
          ariaLabel="Vendor"
          value={vendorName}
          options={vendors}
          onChange={setVendorName}
          allowCreate
          placeholder="Vendor…"
        />
      </div>
      <label className={captionClass}>Stage</label>
      <div className="mb-3">
        <PlainSelect
          ariaLabel="Stage"
          value={stage}
          options={STAGES}
          onChange={(v) => v && setStage(v as LifecycleStage)}
          clearable={false}
        />
      </div>
      <label className={captionClass}>Quantity</label>
      <input
        type="number"
        aria-label="Quantity"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>EOS announced</label>
      <input
        type="date"
        aria-label="EOS announced"
        value={eosAnnounced ?? ""}
        onChange={(e) => setEosAnnounced(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>End of sale</label>
      <input
        type="date"
        aria-label="End of sale"
        value={endOfSale ?? ""}
        onChange={(e) => setEndOfSale(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>End of support</label>
      <input
        type="date"
        aria-label="End of support"
        value={endOfSupport ?? ""}
        onChange={(e) => setEndOfSupport(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>End of life</label>
      <input
        type="date"
        aria-label="End of life"
        value={endOfLife ?? ""}
        onChange={(e) => setEndOfLife(e.target.value)}
        className={`${inputClass} mb-4`}
      />

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        {component != null ? (
          <button onClick={() => setConfirmDelete(true)} className={btnDangerGhost}>
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button onClick={() => void save()} className={btnPrimary}>
            Save
          </button>
        </div>
      </div>
      {confirmDelete && component != null && (
        <ConfirmDialog
          title="Delete component"
          message={`Delete “${component.name}”? Components used by a system or service will block this.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </aside>
  );
}
