import { useEffect, useState } from "react";
import {
  ConflictError,
  createItem,
  createLink,
  deleteItem,
  deleteLink,
  getItem,
  getLinkRelations,
  listItems,
  updateItem,
} from "../api/client";
import type { Item, ItemKind, ItemUpdate, RelationOption } from "../types";
import Field from "./Field";
import ItemActivity from "./ItemActivity";
import ItemComments from "./ItemComments";
import SearchableSelect from "./SearchableSelect";
import WsjfToggle from "./WsjfToggle";

const NUMERIC_FIELDS = new Set([
  "story_points",
  "business_value",
  "time_criticality",
  "risk_reduction",
  "job_size",
]);

const KIND_CHIP: Record<string, string> = {
  feature: "bg-blue-100 text-blue-700",
  story: "bg-slate-100 text-slate-700",
  risk: "bg-red-100 text-red-700",
};
const KIND_ACCENT: Record<string, string> = {
  feature: "bg-blue-500",
  story: "bg-slate-400",
  risk: "bg-red-500",
};

const withCurrent = (current: string | null, options: string[]): string[] =>
  current && !options.includes(current) ? [current, ...options] : options;

export default function ItemDrawer({
  itemId,
  assigneeOptions = [],
  statusOptionsByKind = {},
  planningIntervalOptions = [],
  leadingTeamOptions = [],
  openIds = [],
  onClose,
  onChanged,
  onOpenParent,
  onOpenChild,
  onOpenItem,
  onLinksChanged,
}: {
  itemId: number;
  assigneeOptions?: string[];
  statusOptionsByKind?: Partial<Record<ItemKind, string[]>>;
  planningIntervalOptions?: string[];
  leadingTeamOptions?: string[];
  openIds?: number[];
  onClose: () => void;
  onChanged: () => void;
  onOpenParent?: (parentId: number) => void;
  onOpenChild?: (storyId: number) => void;
  onOpenItem?: (id: number) => void;
  onLinksChanged?: () => void | Promise<void>;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [parent, setParent] = useState<Item | null>(null);
  const [draft, setDraft] = useState<ItemUpdate>({});
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [relations, setRelations] = useState<RelationOption[]>([]);
  const [candidates, setCandidates] = useState<Item[]>([]);
  const [adding, setAdding] = useState(false);
  const [pickRelation, setPickRelation] = useState<RelationOption | null>(null);

  useEffect(() => {
    void getLinkRelations().then(setRelations).catch(() => undefined);
    void listItems().then(setCandidates).catch(() => undefined);
  }, []);

  useEffect(() => {
    setConflict(null);
    void getItem(itemId).then(setItem).catch((e) => setError(String(e)));
  }, [itemId]);

  // For stories, load the parent feature so we can show a link to it.
  useEffect(() => {
    let active = true;
    if (item && item.kind === "story" && item.parent_id != null) {
      void getItem(item.parent_id)
        .then((p) => active && setParent(p))
        .catch(() => active && setParent(null));
    } else {
      setParent(null);
    }
    return () => {
      active = false;
    };
  }, [item]);

  const reloadItem = async () => setItem(await getItem(itemId));

  const addLink = async (relation: RelationOption, otherId: number) => {
    const body =
      relation.direction === "incoming"
        ? { source_id: otherId, target_id: itemId, relation: relation.relation }
        : { source_id: itemId, target_id: otherId, relation: relation.relation };
    try {
      await createLink(body);
      setAdding(false);
      setPickRelation(null);
      await reloadItem();
      await onLinksChanged?.();
    } catch (e) {
      setError(String(e));
    }
  };

  const removeLink = async (linkId: number) => {
    try {
      await deleteLink(linkId);
      await reloadItem();
      await onLinksChanged?.();
    } catch (e) {
      setError(String(e));
    }
  };

  const addStory = async () => {
    const title = window.prompt("New story title");
    if (!title) return;
    await createItem({ kind: "story", title, parent_id: itemId });
    await reloadItem();
  };

  const removeStory = async (storyId: number) => {
    await deleteItem(storyId);
    await reloadItem();
  };

  if (error)
    return (
      <Drawer>
        <CloseBar onClose={onClose} />
        <p className="p-6 text-sm text-red-600">{error}</p>
      </Drawer>
    );
  if (!item)
    return (
      <Drawer>
        <CloseBar onClose={onClose} />
        <p className="p-6 text-sm text-gray-500">Loading…</p>
      </Drawer>
    );

  const value = <K extends keyof Item>(key: K) =>
    (key in draft ? (draft as Record<string, unknown>)[key as string] : item[key]) as
      | string
      | number
      | null;

  const set = (key: string, raw: string) => {
    const next: unknown = NUMERIC_FIELDS.has(key) ? (raw === "" ? null : Number(raw)) : raw;
    setDraft((d) => ({ ...d, [key]: next }));
  };

  const save = async () => {
    try {
      await updateItem(item.id, { ...draft, version: item.version });
      setConflict(null);
      onChanged();
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflict("This item was changed by someone else — showing the latest version.");
        setDraft({});
        await reloadItem();
      } else {
        setError(String(e));
      }
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${item.title}" and any child stories?`)) return;
    await deleteItem(item.id);
    onChanged();
  };

  // Only offer the parent link when the parent isn't already open beside us.
  const showParentLink =
    item.kind === "story" &&
    item.parent_id != null &&
    onOpenParent != null &&
    !openIds.includes(item.parent_id);

  const children = item.children ?? [];

  return (
    <Drawer
      footer={
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            Save
          </button>
          <button
            onClick={remove}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      }
    >
      {conflict && <p className="px-6 pt-3 text-xs font-medium text-amber-700">{conflict}</p>}
      {/* Sticky header with a kind-colored accent, id/WSJF, close, and the title. */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className={`h-1 w-full ${KIND_ACCENT[item.kind] ?? "bg-gray-300"}`} />
        <div className="flex items-center justify-between gap-2 px-5 pt-3">
          <span className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_CHIP[item.kind] ?? "bg-gray-100 text-gray-700"}`}>
              {item.type ?? item.kind}
            </span>
            <span className="text-xs text-gray-400">#{item.id}</span>
            {item.wsjf_score != null && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                WSJF {item.wsjf_score}
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            ✕
          </button>
        </div>
        <div className="px-4 pb-3 pt-1">
          <input
            value={(value("title") as string) ?? ""}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Title"
            className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-lg font-semibold text-gray-900 transition hover:bg-gray-50 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      <div className="space-y-6 p-5">
        {showParentLink && (
          <button
            onClick={() => onOpenParent!(item.parent_id!)}
            className="flex w-full items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-left transition hover:bg-blue-100"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-400">
              Parent feature
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-blue-700">
              {parent ? parent.title : `#${item.parent_id}`}
            </span>
          </button>
        )}

        <Section label="Details">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Status
            </span>
            <SearchableSelect
              ariaLabel="Status"
              value={(value("status") as string | null) || null}
              options={withCurrent(
                (value("status") as string | null) || null,
                statusOptionsByKind[item.kind] ?? [],
              )}
              onChange={(v) => setDraft((d) => ({ ...d, status: v ?? "" }))}
              placeholder="Select status…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Planning Interval
            </span>
            <SearchableSelect
              ariaLabel="Planning Interval"
              value={(value("planning_interval") as string | null) || null}
              options={withCurrent((value("planning_interval") as string | null) || null, planningIntervalOptions)}
              onChange={(v) => setDraft((d) => ({ ...d, planning_interval: v ?? "" }))}
              placeholder="Select planning interval…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Leading Team
            </span>
            <SearchableSelect
              ariaLabel="Leading Team"
              value={(value("leading_team") as string | null) || null}
              options={withCurrent((value("leading_team") as string | null) || null, leadingTeamOptions)}
              onChange={(v) => setDraft((d) => ({ ...d, leading_team: v ?? "" }))}
              placeholder="Select team…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Assignee
            </span>
            <SearchableSelect
              ariaLabel="Assignee"
              value={(value("assignee") as string | null) || null}
              options={assigneeOptions}
              onChange={(v) => setDraft((d) => ({ ...d, assignee: v ?? "" }))}
              placeholder="Search team member…"
            />
          </label>
        </Section>

        <Section label="Estimation">
          {item.kind === "feature" ? (
            <div className="flex flex-col gap-3">
              <WsjfToggle
                label="Business Value"
                value={value("business_value")}
                onChange={(v) => setDraft((d) => ({ ...d, business_value: v }))}
              />
              <WsjfToggle
                label="Time Criticality"
                value={value("time_criticality")}
                onChange={(v) => setDraft((d) => ({ ...d, time_criticality: v }))}
              />
              <WsjfToggle
                label="Risk Reduction"
                value={value("risk_reduction")}
                onChange={(v) => setDraft((d) => ({ ...d, risk_reduction: v }))}
              />
              <WsjfToggle
                label="Job Size"
                value={value("job_size")}
                onChange={(v) => setDraft((d) => ({ ...d, job_size: v }))}
              />
            </div>
          ) : (
            <Field label="Story Points" type="number" value={value("story_points")} onChange={(v) => set("story_points", v)} />
          )}
        </Section>

        {item.kind === "feature" && (
          <Section
            label={`Stories · ${children.length}`}
            action={
              <button
                onClick={addStory}
                className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
              >
                + Add story
              </button>
            }
          >
            <ul className="flex flex-col gap-1.5">
              {children.map((child) => (
                <li
                  key={child.id}
                  className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm transition ${
                    openIds.includes(child.id)
                      ? "border-blue-200 bg-blue-50"
                      : "border-gray-100 bg-gray-50 hover:bg-gray-100"
                  }`}
                >
                  {onOpenChild ? (
                    <button
                      onClick={() => onOpenChild(child.id)}
                      className="min-w-0 flex-1 truncate text-left font-medium text-blue-700 hover:underline"
                    >
                      {child.title}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{child.title}</span>
                  )}
                  <button
                    aria-label={`remove story ${child.id}`}
                    onClick={() => removeStory(child.id)}
                    className="ml-2 shrink-0 rounded p-0.5 text-gray-400 transition hover:bg-white hover:text-red-600"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section
          label="Dependencies"
          action={
            <button
              onClick={() => setAdding((v) => !v)}
              className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
            >
              {adding ? "Cancel" : "+ Add dependency"}
            </button>
          }
        >
          <ul className="flex flex-col gap-1.5">
            {(item.links ?? []).map((link) => (
              <li
                key={link.link_id}
                className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 text-sm transition hover:bg-gray-100"
              >
                <button onClick={() => onOpenItem?.(link.item.id)} className="min-w-0 flex-1 truncate text-left">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    {link.label}
                  </span>{" "}
                  <span className="font-medium text-blue-700 hover:underline">{link.item.title}</span>
                  <span className="ml-1 text-xs text-gray-400">({link.item.kind})</span>
                </button>
                <button
                  aria-label={`remove link ${link.link_id}`}
                  onClick={() => removeLink(link.link_id)}
                  className="ml-2 shrink-0 rounded p-0.5 text-gray-400 transition hover:bg-white hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {adding && (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-gray-200 p-2">
              <ul role="listbox" className="flex flex-col gap-0.5">
                {relations.map((rel) => (
                  <li key={`${rel.relation}-${rel.direction}`}>
                    <button
                      role="option"
                      aria-selected={pickRelation?.label === rel.label}
                      onClick={() => setPickRelation(rel)}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-gray-50 ${
                        pickRelation?.label === rel.label ? "bg-blue-50 font-medium text-blue-700" : "text-gray-700"
                      }`}
                    >
                      {rel.label}
                    </button>
                  </li>
                ))}
              </ul>

              <ItemPicker
                disabled={!pickRelation}
                items={candidates.filter((c) => c.id !== itemId)}
                onPick={(otherId) => pickRelation && void addLink(pickRelation, otherId)}
              />
            </div>
          )}
        </Section>

        <Section label="Comments">
          <ItemComments itemId={item.id} />
        </Section>

        <Section label="Activity">
          <ItemActivity itemId={item.id} />
        </Section>
      </div>
    </Drawer>
  );
}

function Section({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function CloseBar({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex justify-end border-b border-gray-200 px-3 py-2">
      <button
        onClick={onClose}
        aria-label="Close"
        className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
      >
        ✕
      </button>
    </div>
  );
}

// A single docked panel. The full-screen backdrop is owned by the parent so
// multiple panels can sit side by side in one right-docked row.
function Drawer({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <aside
      className="flex h-full w-96 shrink-0 flex-col border-l border-gray-200 bg-white shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-3">{footer}</div>}
    </aside>
  );
}

function ItemPicker({
  items,
  disabled,
  onPick,
}: {
  items: Item[];
  disabled: boolean;
  onPick: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const label = (it: Item) => `${it.title} (#${it.id})`;
  const filtered = items.filter((it) => label(it).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="choose item"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-left text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
      >
        Choose item…
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="mb-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <ul className="max-h-48 overflow-auto">
            {filtered.map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => {
                    onPick(it.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-700 transition hover:bg-gray-50"
                >
                  {label(it)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
