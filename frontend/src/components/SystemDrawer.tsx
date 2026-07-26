import { useState } from "react";
import { createSystem, deleteSystem, removeSystemMember, setSystemMember, updateSystem } from "../api/client";
import type { CatalogSystem, Component, LifecycleStage } from "../types";
import Banner from "./Banner";
import ConfirmDialog from "./ConfirmDialog";
import PlainSelect from "./PlainSelect";
import SearchableSelect from "./SearchableSelect";
import { btnDangerGhost, btnPrimary, btnSecondary, captionClass, inputClass } from "./ui";

const STAGES: LifecycleStage[] = ["plan", "build", "operate", "phase_out", "retired"];

/** System create/edit drawer. `system == null` is create mode (POST);
 *  otherwise edit mode (PATCH, only-changed keys). Membership editing (edit
 *  mode only) commits immediately via setSystemMember/removeSystemMember —
 *  each response is the fresh system, which refreshes the local members list
 *  independent of the Save button. */
export default function SystemDrawer({
  system,
  productId,
  components,
  onClose,
  onChanged,
}: {
  system: CatalogSystem | null;
  productId: number;
  components: Component[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState(system?.name ?? "");
  const [description, setDescription] = useState(system?.description ?? "");
  const [stage, setStage] = useState<LifecycleStage>(system?.lifecycle_stage ?? "plan");
  const [members, setMembers] = useState(system?.members ?? []);
  const [quantities, setQuantities] = useState<Record<number, string>>(
    Object.fromEntries(
      (system?.members ?? []).map((m) => [m.component.id, m.quantity != null ? String(m.quantity) : ""]),
    ),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberIds = new Set(members.map((m) => m.component.id));
  const addable = components.filter((c) => !memberIds.has(c.id));

  const save = async () => {
    setError(null);
    try {
      if (system == null) {
        await createSystem({
          name,
          product_id: productId,
          description: description || null,
          lifecycle_stage: stage,
        });
      } else {
        const changes: Parameters<typeof updateSystem>[1] = {};
        if (name !== system.name) changes.name = name;
        if (description !== (system.description ?? "")) changes.description = description || null;
        if (stage !== system.lifecycle_stage) changes.lifecycle_stage = stage;
        await updateSystem(system.id, changes);
      }
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const syncFromMembership = async (fresh: CatalogSystem) => {
    setMembers(fresh.members);
    setQuantities(
      Object.fromEntries(
        fresh.members.map((m) => [m.component.id, m.quantity != null ? String(m.quantity) : ""]),
      ),
    );
    await onChanged();
  };

  const commitQuantity = async (componentId: number) => {
    if (!system) return;
    setError(null);
    const raw = quantities[componentId] ?? "";
    if (raw.trim() !== "" && Number.isNaN(Number(raw))) return;
    const parsed = raw.trim() === "" ? null : Number(raw);
    try {
      const fresh = await setSystemMember(system.id, componentId, parsed);
      await syncFromMembership(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update quantity");
    }
  };

  const addMember = async (componentId: number) => {
    if (!system) return;
    setError(null);
    try {
      const fresh = await setSystemMember(system.id, componentId, null);
      await syncFromMembership(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add member");
    }
  };

  const removeMember = async (componentId: number) => {
    if (!system) return;
    setError(null);
    try {
      const fresh = await removeSystemMember(system.id, componentId);
      await syncFromMembership(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove member");
    }
  };

  const remove = async () => {
    if (!system) return;
    setError(null);
    try {
      await deleteSystem(system.id);
      await onChanged();
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      setError(e instanceof Error ? e.message : "Delete blocked");
    }
  };

  return (
    <aside
      aria-label="System drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-[26rem] flex-col overflow-y-auto border-l border-gray-200 bg-surface p-5 shadow-2xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          {system == null ? "New system" : "Edit system"}
        </h2>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>
      {error && (
        <div className="mb-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <label className={captionClass}>Name</label>
      <input
        aria-label="System name"
        value={name}
        onChange={(e) => setName(e.target.value)}
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
      <label className={captionClass}>Stage</label>
      <div className="mb-4">
        <PlainSelect
          ariaLabel="Stage"
          value={stage}
          options={STAGES}
          onChange={(v) => v && setStage(v as LifecycleStage)}
          clearable={false}
        />
      </div>

      {system != null && (
        <>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Members</h3>
          <ul className="mb-2 flex flex-col gap-1.5">
            {members.map((m) => (
              <li
                key={m.component.id}
                className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-sm"
              >
                <span className="flex-1 truncate text-gray-800">{m.component.name}</span>
                <input
                  type="number"
                  aria-label={`Quantity for ${m.component.name}`}
                  value={quantities[m.component.id] ?? ""}
                  onChange={(e) =>
                    setQuantities((q) => ({ ...q, [m.component.id]: e.target.value }))
                  }
                  onBlur={() => void commitQuantity(m.component.id)}
                  onKeyDown={(e) => e.key === "Enter" && void commitQuantity(m.component.id)}
                  className="w-16 rounded-lg border border-gray-300 bg-surface px-2 py-1 text-sm text-gray-900 transition focus:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
                />
                <button
                  aria-label={`Remove ${m.component.name}`}
                  onClick={() => void removeMember(m.component.id)}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
            {members.length === 0 && <li className="text-sm text-gray-400">None</li>}
          </ul>
          <div className="mb-4">
            <SearchableSelect
              ariaLabel="Add component member"
              value={null}
              options={addable.map((c) => c.name)}
              onChange={(picked) => {
                if (!picked) return;
                const target = addable.find((c) => c.name === picked);
                if (target) void addMember(target.id);
              }}
              placeholder="Add component…"
            />
          </div>
        </>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        {system != null ? (
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
      {confirmDelete && system != null && (
        <ConfirmDialog
          title="Delete system"
          message={`Delete “${system.name}”? Systems used by a service will block this.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </aside>
  );
}
