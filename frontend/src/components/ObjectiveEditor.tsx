import { useState } from "react";
import { createPIObjective, setObjectiveFeatures, updatePIObjective } from "../api/client";
import type { Item, ObjectiveState, PIObjective } from "../types";
import PlainSelect from "./PlainSelect";
import { btnGhost, inputClass, modalPanelClass, overlayClass } from "./ui";

const STATES: { value: ObjectiveState; label: string }[] = [
  { value: "committed", label: "Committed" },
  { value: "uncommitted", label: "Uncommitted" },
  { value: "out_of_scope", label: "Out of scope" },
];
const labelFor = (s: ObjectiveState) => STATES.find((x) => x.value === s)!.label;
const valueFor = (label: string) => STATES.find((x) => x.label === label)?.value ?? "uncommitted";

export default function ObjectiveEditor({
  existing,
  teamId,
  teamName,
  planningInterval,
  features,
  onClose,
  onSaved,
}: {
  existing?: PIObjective;
  teamId: number;
  teamName: string;
  planningInterval: string;
  features: Item[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const scoped = features.filter(
    (f) => f.leading_team === teamName && f.planning_interval === planningInterval,
  );
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [state, setState] = useState<ObjectiveState>(existing?.state ?? "uncommitted");
  const [keyDelivery, setKeyDelivery] = useState(existing?.is_key_delivery ?? false);
  const [featureIds, setFeatureIds] = useState<number[]>(existing?.feature_ids ?? []);
  const [featureQuery, setFeatureQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const q = featureQuery.trim().toLowerCase();
  const selectedFeatures = scoped.filter((f) => featureIds.includes(f.id));
  const unselected = scoped.filter((f) => !featureIds.includes(f.id));
  const visibleUnselected = q
    ? unselected.filter((f) => f.title.toLowerCase().includes(q) || String(f.id).includes(q))
    : unselected;

  const toggleFeature = (id: number) =>
    setFeatureIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const save = async () => {
    setSaving(true);
    try {
      const key = state === "committed" ? keyDelivery : false;
      let id = existing?.id;
      if (id == null) {
        const created = await createPIObjective({
          team_id: teamId,
          planning_interval: planningInterval,
          title: title.trim(),
          description: description || null,
          state,
          is_key_delivery: key,
        });
        id = created.id;
      } else {
        await updatePIObjective(id, {
          title: title.trim(),
          description: description || null,
          state,
          is_key_delivery: key,
        });
      }
      await setObjectiveFeatures(id, featureIds);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${overlayClass} z-30`} onClick={onClose}>
      <div className={`${modalPanelClass} max-w-lg`} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          {existing ? "Edit" : "New"} PI Objective · {teamName} · {planningInterval}
        </h2>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Title</span>
          <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} className={`w-full ${inputClass}`} />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Description</span>
          <textarea aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`w-full ${inputClass}`} />
        </label>
        <div className="mb-3 flex items-end gap-4">
          <div className="flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-500">State</span>
            <PlainSelect
              ariaLabel="State"
              value={labelFor(state)}
              options={STATES.map((s) => s.label)}
              onChange={(v) => setState(v ? valueFor(v) : "uncommitted")}
              placeholder="Select state"
            />
          </div>
          <label className="flex items-center gap-2 py-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              aria-label="Key Delivery"
              checked={state === "committed" && keyDelivery}
              disabled={state !== "committed"}
              onChange={(e) => setKeyDelivery(e.target.checked)}
            />
            Key Delivery
          </label>
        </div>
        <div className="mb-4">
          <span className="mb-1 block text-xs font-medium text-gray-500">
            Linked features {featureIds.length > 0 && <span className="text-gray-400">({featureIds.length} selected)</span>}
          </span>
          {scoped.length > 0 && (
            <input
              aria-label="Search features"
              placeholder="Search features…"
              value={featureQuery}
              onChange={(e) => setFeatureQuery(e.target.value)}
              className={`mb-2 w-full ${inputClass}`}
            />
          )}
          <div className="max-h-40 overflow-auto rounded-lg border border-gray-200 p-2">
            {scoped.length === 0 && (
              <p className="text-xs text-gray-400">No features for this team + PI.</p>
            )}
            {/* Selected features pinned on top, always visible regardless of search. */}
            {selectedFeatures.map((f) => (
              <label key={f.id} className="flex items-center gap-2 py-0.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  aria-label={f.title}
                  checked
                  onChange={() => toggleFeature(f.id)}
                />
                <span className="text-xs text-gray-400">#{f.id}</span> {f.title}
              </label>
            ))}
            {selectedFeatures.length > 0 && visibleUnselected.length > 0 && (
              <div className="my-1 border-t border-gray-100" />
            )}
            {visibleUnselected.map((f) => (
              <label key={f.id} className="flex items-center gap-2 py-0.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  aria-label={f.title}
                  checked={false}
                  onChange={() => toggleFeature(f.id)}
                />
                <span className="text-xs text-gray-400">#{f.id}</span> {f.title}
              </label>
            ))}
            {scoped.length > 0 && selectedFeatures.length === 0 && visibleUnselected.length === 0 && (
              <p className="text-xs text-gray-400">No features match “{featureQuery}”.</p>
            )}
          </div>
        </div>
        <div className="flex justify-between">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button
            onClick={() => void save()}
            disabled={!title.trim() || saving}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
