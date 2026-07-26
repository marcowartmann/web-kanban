import { useCallback, useEffect, useState } from "react";
import {
  createService,
  getProductComponents,
  getProductContracts,
  getProductServices,
  getProductSystems,
} from "../api/client";
import PageHeader from "../shell/PageHeader";
import type { CatalogService, CatalogSystem, Component, LifecycleState, Product, SupportContract } from "../types";
import ComponentDrawer from "./ComponentDrawer";
import ContractBadge from "./ContractBadge";
import ContractDrawer from "./ContractDrawer";
import RiskBadge from "./RiskBadge";
import ServiceDrawer from "./ServiceDrawer";
import SystemDrawer from "./SystemDrawer";
import { btnPrimary, btnSecondary, inputClass } from "./ui";

/** Sums non-null numbers; returns null (renders "—") when every input is null. */
function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

// Flat "Parent › Child" path labels for the drawer's parent picker.
function flatten(nodes: CatalogService[], prefix = ""): { id: number; label: string }[] {
  return nodes.flatMap((n) => {
    const label = prefix ? `${prefix} › ${n.name}` : n.name;
    return [{ id: n.id, label }, ...flatten(n.children, label)];
  });
}

function subtreeIds(node: CatalogService): number[] {
  return [node.id, ...node.children.flatMap(subtreeIds)];
}

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
  onAddChild,
}: {
  service: CatalogService;
  depth: number;
  onOpen: (s: CatalogService) => void;
  onAddChild: (s: CatalogService) => void;
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
        <button
          aria-label={`Add sub-service to ${service.name}`}
          title="Add sub-service"
          onClick={() => onAddChild(service)}
          className="rounded-sm px-1 text-xs text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
        >
          +
        </button>
        {service.owner_name && <span className="text-xs text-gray-400">{service.owner_name}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[service.lifecycle_state]}`}>
          {service.lifecycle_state}
        </span>
      </div>
      {open &&
        service.children.map((c) => (
          <ServiceNode key={c.id} service={c} depth={depth + 1} onOpen={onOpen} onAddChild={onAddChild} />
        ))}
    </div>
  );
}

function SystemRow({ system, onOpen }: { system: CatalogSystem; onOpen: (s: CatalogSystem) => void }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-gray-200 bg-surface px-3 py-2">
      <button onClick={() => onOpen(system)} className="flex-1 text-left text-sm font-medium text-gray-800">
        {system.name}
      </button>
      <span className="text-xs text-gray-500">{system.members.length} components</span>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
        {system.lifecycle_stage}
      </span>
      <RiskBadge risk={system.risk} />
    </div>
  );
}

function ContractRow({
  contract,
  onOpen,
}: {
  contract: SupportContract;
  onOpen: (c: SupportContract) => void;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-gray-200 bg-surface px-3 py-2">
      <button onClick={() => onOpen(contract)} className="flex-1 text-left text-sm font-medium text-gray-800">
        {contract.name}
      </button>
      {contract.vendor_name && <span className="text-xs text-gray-400">{contract.vendor_name}</span>}
      <span className="text-xs text-gray-500">{contract.end_date ?? "—"}</span>
      <ContractBadge status={contract.status} />
      <span className="w-20 text-right text-xs text-gray-500">
        {contract.yearly_cost?.toLocaleString() ?? "—"}
      </span>
    </div>
  );
}

function ComponentRow({ component, onOpen }: { component: Component; onOpen: (c: Component) => void }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-gray-200 bg-surface px-3 py-2">
      <button onClick={() => onOpen(component)} className="flex flex-1 items-baseline gap-1.5 text-left">
        <span className="text-sm font-medium text-gray-800">{component.name}</span>
        {component.model && <span className="text-xs text-gray-400">{component.model}</span>}
      </button>
      {component.vendor_name && <span className="text-xs text-gray-400">{component.vendor_name}</span>}
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
        {component.lifecycle_stage}
      </span>
      <RiskBadge risk={component.risk} />
      <span className="text-xs text-gray-500">{component.quantity ?? "—"}</span>
    </div>
  );
}

export default function ProductDetail({ product }: { product: Product }) {
  const [tab, setTab] = useState<"services" | "systems" | "components" | "contracts">("services");
  const [tree, setTree] = useState<CatalogService[]>([]);
  const [drawer, setDrawer] = useState<CatalogService | null>(null);
  // null = form closed; parentId null = add at root, otherwise sub-service.
  const [addTarget, setAddTarget] = useState<{ parentId: number | null; parentName: string | null } | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [components, setComponents] = useState<Component[]>([]);
  const [componentDrawerOpen, setComponentDrawerOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<Component | null>(null);

  const [systems, setSystems] = useState<CatalogSystem[]>([]);
  const [systemDrawerOpen, setSystemDrawerOpen] = useState(false);
  const [editingSystem, setEditingSystem] = useState<CatalogSystem | null>(null);

  const [contracts, setContracts] = useState<SupportContract[]>([]);
  const [contractDrawerOpen, setContractDrawerOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<SupportContract | null>(null);

  const load = useCallback(
    () => getProductServices(product.id).then(setTree),
    [product.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const loadComponents = useCallback(
    () => getProductComponents(product.id).then(setComponents),
    [product.id],
  );
  // The Systems tab's drawer needs the product's components too (member
  // picker), and the Contracts tab's totals footer sums their run costs.
  useEffect(() => {
    if (tab === "components" || tab === "systems" || tab === "contracts") void loadComponents();
  }, [tab, loadComponents]);

  const loadSystems = useCallback(
    () => getProductSystems(product.id).then(setSystems),
    [product.id],
  );
  useEffect(() => {
    if (tab === "systems") void loadSystems();
  }, [tab, loadSystems]);

  const loadContracts = useCallback(
    () => getProductContracts(product.id).then(setContracts),
    [product.id],
  );
  useEffect(() => {
    if (tab === "contracts") void loadContracts();
  }, [tab, loadContracts]);

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm font-medium transition ${
      active
        ? "border-blue-600 bg-blue-600 text-white shadow-xs"
        : "border-gray-200 bg-surface text-gray-600 hover:bg-gray-50"
    }`;

  const addService = async () => {
    if (!newName.trim() || !addTarget) return;
    setError(null);
    try {
      await createService({
        name: newName.trim(),
        product_id: product.id,
        ...(addTarget.parentId != null ? { parent_service_id: addTarget.parentId } : {}),
      });
      setNewName("");
      setAddTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create service");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={product.name}
        subtitle={`${product.art_name}${product.team_name ? ` · Team ${product.team_name}` : ""}`}
        backTo={{ label: "Back to products", to: "/products" }}
        actions={
          <>
            {tab === "services" && (
              <button
                onClick={() => setAddTarget((t) => (t ? null : { parentId: null, parentName: null }))}
                className={btnSecondary}
              >
                Add service
              </button>
            )}
            {tab === "systems" && (
              <button
                onClick={() => {
                  setEditingSystem(null);
                  setSystemDrawerOpen(true);
                }}
                className={btnSecondary}
              >
                Add system
              </button>
            )}
            {tab === "components" && (
              <button
                onClick={() => {
                  setEditingComponent(null);
                  setComponentDrawerOpen(true);
                }}
                className={btnSecondary}
              >
                Add component
              </button>
            )}
            {tab === "contracts" && (
              <button
                onClick={() => {
                  setEditingContract(null);
                  setContractDrawerOpen(true);
                }}
                className={btnSecondary}
              >
                Add contract
              </button>
            )}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {product.description && (
          <p className="mb-4 max-w-2xl text-sm text-gray-600">{product.description}</p>
        )}

        <div className="mb-5 flex gap-2">
          <button onClick={() => setTab("services")} className={pill(tab === "services")}>
            Services
          </button>
          <button onClick={() => setTab("systems")} className={pill(tab === "systems")}>
            Systems
          </button>
          <button onClick={() => setTab("components")} className={pill(tab === "components")}>
            Components
          </button>
          <button onClick={() => setTab("contracts")} className={pill(tab === "contracts")}>
            Contracts
          </button>
        </div>

        {tab === "services" && (
          <>
            {addTarget && (
              <div className="mb-4 flex max-w-xl items-center gap-2">
                {addTarget.parentName && (
                  <span className="shrink-0 text-xs text-gray-500">
                    Sub-service of <span className="font-medium">{addTarget.parentName}</span>
                  </span>
                )}
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
              tree.map((s) => (
                <ServiceNode
                  key={s.id}
                  service={s}
                  depth={0}
                  onOpen={setDrawer}
                  onAddChild={(svc) => setAddTarget({ parentId: svc.id, parentName: svc.name })}
                />
              ))
            )}
          </>
        )}

        {tab === "systems" && (
          <>
            {systems.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No systems yet.</div>
            ) : (
              systems.map((s) => (
                <SystemRow
                  key={s.id}
                  system={s}
                  onOpen={(sys) => {
                    setEditingSystem(sys);
                    setSystemDrawerOpen(true);
                  }}
                />
              ))
            )}
          </>
        )}

        {tab === "components" && (
          <>
            {components.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No components yet.</div>
            ) : (
              components.map((c) => (
                <ComponentRow
                  key={c.id}
                  component={c}
                  onOpen={(comp) => {
                    setEditingComponent(comp);
                    setComponentDrawerOpen(true);
                  }}
                />
              ))
            )}
          </>
        )}

        {tab === "contracts" && (
          <>
            {contracts.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No contracts yet.</div>
            ) : (
              contracts.map((c) => (
                <ContractRow
                  key={c.id}
                  contract={c}
                  onOpen={(con) => {
                    setEditingContract(con);
                    setContractDrawerOpen(true);
                  }}
                />
              ))
            )}
            <div className="mt-4 flex flex-col gap-1 border-t border-gray-200 pt-3 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Contract costs / yr</span>
                <span>{sumOrNull(contracts.map((c) => c.yearly_cost))?.toLocaleString() ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Run costs / yr</span>
                <span>{sumOrNull(components.map((c) => c.yearly_run_cost))?.toLocaleString() ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Replacement budget</span>
                <span>{sumOrNull(components.map((c) => c.replacement_budget))?.toLocaleString() ?? "—"}</span>
              </div>
            </div>
          </>
        )}
      </div>
      {drawer && (
        <ServiceDrawer
          key={drawer.id}
          service={drawer}
          productId={product.id}
          parentOptions={(() => {
            const excluded = new Set(subtreeIds(drawer));
            return flatten(tree).filter((o) => !excluded.has(o.id));
          })()}
          onClose={() => setDrawer(null)}
          onChanged={async () => {
            await load();
          }}
        />
      )}
      {componentDrawerOpen && (
        <ComponentDrawer
          key={editingComponent?.id ?? "new"}
          component={editingComponent}
          productId={product.id}
          onClose={() => setComponentDrawerOpen(false)}
          onChanged={async () => {
            await loadComponents();
          }}
        />
      )}
      {systemDrawerOpen && (
        <SystemDrawer
          key={editingSystem?.id ?? "new"}
          system={editingSystem}
          productId={product.id}
          components={components}
          onClose={() => setSystemDrawerOpen(false)}
          onChanged={async () => {
            await loadSystems();
          }}
        />
      )}
      {contractDrawerOpen && (
        <ContractDrawer
          key={editingContract?.id ?? "new"}
          contract={editingContract}
          productId={product.id}
          onClose={() => setContractDrawerOpen(false)}
          onChanged={async () => {
            await loadContracts();
          }}
        />
      )}
    </div>
  );
}
