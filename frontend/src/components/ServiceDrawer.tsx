import { useCallback, useEffect, useState } from "react";
import {
  addServiceDependency,
  addServiceTechComponent,
  addServiceTechSystem,
  deleteService,
  getLifecycle,
  getPersonOptions,
  getServiceDependencies,
  getServiceOptions,
  getServiceTech,
  getSystems,
  removeServiceDependency,
  removeServiceTechComponent,
  removeServiceTechSystem,
  updateService,
} from "../api/client";
import type {
  CatalogService,
  CatalogSystem,
  Component,
  DependencyCriticality,
  DependencyType,
  PersonOption,
  ServiceDependencies,
  ServiceOption,
  ServiceTech,
} from "../types";
import Badge from "./Badge";
import ConfirmDialog from "./ConfirmDialog";
import PlainSelect from "./PlainSelect";
import RiskBadge from "./RiskBadge";
import SearchableSelect from "./SearchableSelect";
import { btnDangerGhost, btnPrimary, btnSecondary, captionClass, inputClass } from "./ui";

const STATES = ["planned", "active", "deprecated", "retired"];
const DEP_TYPES: DependencyType[] = ["requires", "uses"];
const CRITICALITIES: DependencyCriticality[] = ["critical", "important", "optional"];

export default function ServiceDrawer({
  service,
  parentOptions,
  onClose,
  onChanged,
}: {
  service: CatalogService;
  productId: number;
  /** Same-product services offered as parent, path-labeled, excluding this
   *  service and its descendants (a service cannot be parented into its own subtree). */
  parentOptions: { id: number; label: string }[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState(service.name);
  const [description, setDescription] = useState(service.description ?? "");
  const [state, setState] = useState<string>(service.lifecycle_state);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [ownerName, setOwnerName] = useState<string | null>(service.owner_name);
  const [parentLabel, setParentLabel] = useState<string | null>(
    parentOptions.find((o) => o.id === service.parent_service_id)?.label ?? null,
  );
  const [deps, setDeps] = useState<ServiceDependencies>({ outbound: [], inbound: [] });
  const [options, setOptions] = useState<ServiceOption[]>([]);
  const [depTarget, setDepTarget] = useState<string | null>(null);
  const [depType, setDepType] = useState<DependencyType>("requires");
  const [depCrit, setDepCrit] = useState<DependencyCriticality>("important");
  const [tech, setTech] = useState<ServiceTech>({ components: [], systems: [], risk: "ok" });
  const [allSystems, setAllSystems] = useState<CatalogSystem[]>([]);
  const [allComponents, setAllComponents] = useState<Component[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDeps = useCallback(
    () => getServiceDependencies(service.id).then(setDeps),
    [service.id],
  );
  const loadTech = useCallback(
    () => getServiceTech(service.id).then(setTech),
    [service.id],
  );
  useEffect(() => {
    void loadDeps();
    void loadTech();
    void getPersonOptions().then(setPeople);
    void getServiceOptions().then(setOptions);
    void getSystems().then(setAllSystems);
    void getLifecycle().then(setAllComponents);
  }, [loadDeps, loadTech]);

  const optionLabel = (o: ServiceOption) => `${o.name} (${o.product_name ?? "?"})`;
  const pickable = options.filter((o) => o.id !== service.id);

  const systemLabel = (s: CatalogSystem) => `${s.name} (${s.product_name ?? "?"})`;
  const componentLabel = (c: Component) => `${c.name} (${c.product_name ?? "?"})`;
  const linkedSystemIds = new Set(tech.systems.map((s) => s.id));
  const linkedComponentIds = new Set(tech.components.map((c) => c.id));
  const addableSystems = allSystems.filter((s) => !linkedSystemIds.has(s.id));
  const addableComponents = allComponents.filter((c) => !linkedComponentIds.has(c.id));

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
      const parentId = parentLabel
        ? parentOptions.find((o) => o.label === parentLabel)?.id ?? null
        : null;
      if (parentId !== service.parent_service_id) changes.parent_service_id = parentId;
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

  const addSystem = async (systemId: number) => {
    setError(null);
    try {
      setTech(await addServiceTechSystem(service.id, systemId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add system");
    }
  };

  const removeSystem = async (systemId: number) => {
    setError(null);
    try {
      setTech(await removeServiceTechSystem(service.id, systemId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove system");
    }
  };

  const addComponent = async (componentId: number) => {
    setError(null);
    try {
      setTech(await addServiceTechComponent(service.id, componentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add component");
    }
  };

  const removeComponent = async (componentId: number) => {
    setError(null);
    try {
      setTech(await removeServiceTechComponent(service.id, componentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove component");
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
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900">Edit service</h2>
          <RiskBadge risk={tech.risk} />
        </div>
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
      <div className="mb-3">
        <SearchableSelect
          ariaLabel="Service owner"
          value={ownerName}
          options={people.map((p) => p.display_name)}
          onChange={setOwnerName}
        />
      </div>
      <label className={captionClass}>Parent</label>
      <div className="mb-4">
        <SearchableSelect
          ariaLabel="Parent service"
          value={parentLabel}
          options={parentOptions.map((o) => o.label)}
          onChange={setParentLabel}
          placeholder="No parent (top-level)"
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
            <Badge tone="gray">{d.dep_type}</Badge>
            <Badge tone="amber">{d.criticality}</Badge>
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

      <h3 className="mb-2 mt-2 text-sm font-semibold text-gray-700">Provided by</h3>
      <ul className="mb-2 flex flex-col gap-1.5">
        {tech.systems.map((s) => (
          <li key={`system-${s.id}`} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-sm">
            <span className="flex-1 truncate text-gray-800">{s.name}</span>
            <RiskBadge risk={s.risk} />
            <button
              aria-label={`Unlink ${s.name}`}
              onClick={() => void removeSystem(s.id)}
              className="text-xs text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          </li>
        ))}
        {tech.components.map((c) => (
          <li key={`component-${c.id}`} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-sm">
            <span className="flex-1 truncate text-gray-800">{c.name}</span>
            <RiskBadge risk={c.risk} />
            <button
              aria-label={`Unlink ${c.name}`}
              onClick={() => void removeComponent(c.id)}
              className="text-xs text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          </li>
        ))}
        {tech.systems.length === 0 && tech.components.length === 0 && (
          <li className="text-sm text-gray-400">None</li>
        )}
      </ul>
      <div className="mb-1.5">
        <SearchableSelect
          ariaLabel="Add system"
          value={null}
          options={addableSystems.map(systemLabel)}
          onChange={(picked) => {
            if (!picked) return;
            const target = addableSystems.find((s) => systemLabel(s) === picked);
            if (target) void addSystem(target.id);
          }}
          placeholder="Add system…"
        />
      </div>
      <div className="mb-4">
        <SearchableSelect
          ariaLabel="Add component"
          value={null}
          options={addableComponents.map(componentLabel)}
          onChange={(picked) => {
            if (!picked) return;
            const target = addableComponents.find((c) => componentLabel(c) === picked);
            if (target) void addComponent(target.id);
          }}
          placeholder="Add component…"
        />
      </div>

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
