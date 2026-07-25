import { useCallback, useEffect, useState } from "react";
import {
  addServiceDependency,
  deleteService,
  getPersonOptions,
  getServiceDependencies,
  getServiceOptions,
  removeServiceDependency,
  updateService,
} from "../api/client";
import type {
  CatalogService,
  DependencyCriticality,
  DependencyType,
  PersonOption,
  ServiceDependencies,
  ServiceOption,
} from "../types";
import ConfirmDialog from "./ConfirmDialog";
import PlainSelect from "./PlainSelect";
import SearchableSelect from "./SearchableSelect";
import { btnDangerGhost, btnPrimary, btnSecondary, captionClass, inputClass } from "./ui";

const STATES = ["planned", "active", "deprecated", "retired"];
const DEP_TYPES: DependencyType[] = ["requires", "uses"];
const CRITICALITIES: DependencyCriticality[] = ["critical", "important", "optional"];

export default function ServiceDrawer({
  service,
  onClose,
  onChanged,
}: {
  service: CatalogService;
  productId: number;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState(service.name);
  const [description, setDescription] = useState(service.description ?? "");
  const [state, setState] = useState<string>(service.lifecycle_state);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [ownerName, setOwnerName] = useState<string | null>(service.owner_name);
  const [deps, setDeps] = useState<ServiceDependencies>({ outbound: [], inbound: [] });
  const [options, setOptions] = useState<ServiceOption[]>([]);
  const [depTarget, setDepTarget] = useState<string | null>(null);
  const [depType, setDepType] = useState<DependencyType>("requires");
  const [depCrit, setDepCrit] = useState<DependencyCriticality>("important");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDeps = useCallback(
    () => getServiceDependencies(service.id).then(setDeps),
    [service.id],
  );
  useEffect(() => {
    void loadDeps();
    void getPersonOptions().then(setPeople);
    void getServiceOptions().then(setOptions);
  }, [loadDeps]);

  const optionLabel = (o: ServiceOption) => `${o.name} (${o.product_name ?? "?"})`;
  const pickable = options.filter((o) => o.id !== service.id);

  const save = async () => {
    setError(null);
    try {
      const changes: Parameters<typeof updateService>[1] = {
        name,
        description: description || null,
        lifecycle_state: state as CatalogService["lifecycle_state"],
      };
      if (ownerName !== service.owner_name) {
        const owner = people.find((p) => p.display_name === ownerName);
        changes.owner_user_id = owner ? owner.id : null;
      }
      await updateService(service.id, changes);
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const addDep = async () => {
    const target = pickable.find((o) => optionLabel(o) === depTarget);
    if (!target) return;
    setError(null);
    try {
      await addServiceDependency(service.id, {
        to_service_id: target.id,
        dep_type: depType,
        criticality: depCrit,
      });
      setDepTarget(null);
      await loadDeps();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add dependency");
    }
  };

  const removeDep = async (depId: number) => {
    setError(null);
    try {
      await removeServiceDependency(service.id, depId);
      await loadDeps();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove dependency");
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await deleteService(service.id);
      await onChanged();
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      setError(e instanceof Error ? e.message : "Delete blocked");
    }
  };

  return (
    <aside
      aria-label="Service drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-[26rem] flex-col overflow-y-auto border-l border-gray-200 bg-surface p-5 shadow-2xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Edit service</h2>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>
      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <label className={captionClass}>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mb-3`} />
      <label className={captionClass}>Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Lifecycle</label>
      <div className="mb-3">
        <PlainSelect
          ariaLabel="Lifecycle state"
          value={state}
          options={STATES}
          onChange={(v) => v && setState(v)}
          clearable={false}
        />
      </div>
      <label className={captionClass}>Owner</label>
      <div className="mb-4">
        <SearchableSelect
          ariaLabel="Service owner"
          value={ownerName}
          options={people.map((p) => p.display_name)}
          onChange={setOwnerName}
        />
      </div>

      <h3 className="mb-2 text-sm font-semibold text-gray-700">Depends on</h3>
      <ul className="mb-2 flex flex-col gap-1.5">
        {deps.outbound.map((d) => (
          <li key={d.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-sm">
            <span className="flex-1 truncate text-gray-800">
              {d.to_service_name}
              <span className="text-gray-400"> ({d.to_product_name})</span>
            </span>
            <span className="rounded-full bg-gray-200 px-1.5 text-xs text-gray-600">{d.dep_type}</span>
            <span className="rounded-full bg-amber-50 px-1.5 text-xs text-amber-700">{d.criticality}</span>
            <button
              aria-label={`Remove dependency on ${d.to_service_name}`}
              onClick={() => void removeDep(d.id)}
              className="text-xs text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          </li>
        ))}
        {deps.outbound.length === 0 && <li className="text-sm text-gray-400">None</li>}
      </ul>
      <div className="mb-1.5">
        <SearchableSelect
          ariaLabel="Add dependency"
          value={depTarget}
          options={pickable.map(optionLabel)}
          onChange={setDepTarget}
          placeholder="Add dependency…"
        />
      </div>
      {depTarget && (
        <div className="mb-3 flex items-center gap-2">
          <PlainSelect
            ariaLabel="Dependency type"
            value={depType}
            options={DEP_TYPES as unknown as string[]}
            onChange={(v) => v && setDepType(v as DependencyType)}
            clearable={false}
          />
          <PlainSelect
            ariaLabel="Dependency criticality"
            value={depCrit}
            options={CRITICALITIES as unknown as string[]}
            onChange={(v) => v && setDepCrit(v as DependencyCriticality)}
            clearable={false}
          />
          <button onClick={() => void addDep()} className={btnSecondary}>
            Add
          </button>
        </div>
      )}

      <h3 className="mb-2 mt-2 text-sm font-semibold text-gray-700">Used by</h3>
      <ul className="mb-4 flex flex-col gap-1.5">
        {deps.inbound.map((d) => (
          <li key={d.id} className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-sm text-gray-800">
            {d.from_service_name}
            <span className="text-gray-400"> ({d.from_product_name})</span>
          </li>
        ))}
        {deps.inbound.length === 0 && <li className="text-sm text-gray-400">None</li>}
      </ul>

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <button onClick={() => setConfirmDelete(true)} className={btnDangerGhost}>
          Delete
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button onClick={() => void save()} className={btnPrimary}>
            Save
          </button>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete service"
          message={`Delete “${service.name}”? Sub-services or inbound dependencies will block this.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </aside>
  );
}
