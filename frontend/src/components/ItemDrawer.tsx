import { useEffect, useState } from "react";
import { createItem, createLink, deleteItem, deleteLink, getItem, getLinkRelations, listItems, updateItem } from "../api/client";
import type { Item, ItemUpdate, RelationOption } from "../types";
import Field from "./Field";
import SearchableSelect from "./SearchableSelect";

const NUMERIC_FIELDS = new Set([
  "story_points", "business_value", "time_criticality",
  "risk_reduction", "job_size",
]);

export default function ItemDrawer({
  itemId,
  assigneeOptions = [],
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
  const [relations, setRelations] = useState<RelationOption[]>([]);
  const [candidates, setCandidates] = useState<Item[]>([]);
  const [adding, setAdding] = useState(false);
  const [pickRelation, setPickRelation] = useState<RelationOption | null>(null);

  useEffect(() => {
    void getLinkRelations().then(setRelations).catch(() => undefined);
    void listItems().then(setCandidates).catch(() => undefined);
  }, []);

  useEffect(() => {
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

  if (error) return <Drawer onClose={onClose}><p className="text-red-600">{error}</p></Drawer>;
  if (!item) return <Drawer onClose={onClose}><p>Loading…</p></Drawer>;

  const value = <K extends keyof Item>(key: K) =>
    (key in draft ? (draft as Record<string, unknown>)[key as string] : item[key]) as
      | string
      | number
      | null;

  const set = (key: string, raw: string) => {
    const next: unknown = NUMERIC_FIELDS.has(key)
      ? raw === "" ? null : Number(raw)
      : raw;
    setDraft((d) => ({ ...d, [key]: next }));
  };

  const save = async () => {
    try {
      await updateItem(item.id, draft);
      onChanged();
    } catch (e) {
      setError(String(e));
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

  return (
    <Drawer onClose={onClose}>
      <div className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
            {item.type ?? item.kind}
          </span>
          <span className="text-xs text-gray-400">#{item.id}</span>
        </span>
        {item.wsjf_score != null && (
          <span className="text-sm font-semibold text-gray-700">
            WSJF {item.wsjf_score}
          </span>
        )}
      </div>

      {showParentLink && (
        <div className="mb-4 rounded bg-blue-50 px-3 py-2">
          <span className="block text-xs font-medium text-gray-500">Parent feature</span>
          <button
            onClick={() => onOpenParent!(item.parent_id!)}
            className="mt-0.5 block max-w-full truncate text-left text-sm font-medium text-blue-700 hover:underline"
          >
            {parent ? parent.title : `#${item.parent_id}`}
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <Field label="Title" value={value("title")} onChange={(v) => set("title", v)} />
        <Field label="Status" value={value("status")} onChange={(v) => set("status", v)} />
        <Field label="Planning Interval" value={value("planning_interval")} onChange={(v) => set("planning_interval", v)} />
        <Field label="Leading Team" value={value("leading_team")} onChange={(v) => set("leading_team", v)} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Assignee</span>
          <SearchableSelect
            value={(value("assignee") as string | null) || null}
            options={assigneeOptions}
            onChange={(v) => setDraft((d) => ({ ...d, assignee: v ?? "" }))}
            placeholder="Search team member…"
          />
        </label>
        <Field label="Story Points" type="number" value={value("story_points")} onChange={(v) => set("story_points", v)} />
        <Field label="Business Value" type="number" value={value("business_value")} onChange={(v) => set("business_value", v)} />
        <Field label="Time Criticality" type="number" value={value("time_criticality")} onChange={(v) => set("time_criticality", v)} />
        <Field label="Risk Reduction" type="number" value={value("risk_reduction")} onChange={(v) => set("risk_reduction", v)} />
        <Field label="Job Size" type="number" value={value("job_size")} onChange={(v) => set("job_size", v)} />
      </div>

      {item.kind === "feature" && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Stories</h3>
            <button
              onClick={addStory}
              className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
            >
              + Add story
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {(item.children ?? []).map((child) => (
              <li
                key={child.id}
                className={`flex items-center justify-between rounded px-2 py-1 text-sm ${
                  openIds.includes(child.id) ? "bg-blue-100" : "bg-gray-50"
                }`}
              >
                {onOpenChild ? (
                  <button
                    onClick={() => onOpenChild(child.id)}
                    className="min-w-0 flex-1 truncate text-left text-blue-700 hover:underline"
                  >
                    {child.title}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                )}
                <button
                  aria-label={`remove story ${child.id}`}
                  onClick={() => removeStory(child.id)}
                  className="ml-2 shrink-0 text-gray-400 hover:text-red-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Dependencies</h3>
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
          >
            {adding ? "Cancel" : "+ Add dependency"}
          </button>
        </div>

        <ul className="flex flex-col gap-1">
          {(item.links ?? []).map((link) => (
            <li
              key={link.link_id}
              className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm"
            >
              <button
                onClick={() => onOpenItem?.(link.item.id)}
                className="min-w-0 flex-1 truncate text-left"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {link.label}
                </span>{" "}
                <span className="text-blue-700 hover:underline">{link.item.title}</span>
                <span className="ml-1 text-xs text-gray-400">({link.item.kind})</span>
              </button>
              <button
                aria-label={`remove link ${link.link_id}`}
                onClick={() => removeLink(link.link_id)}
                className="ml-2 shrink-0 text-gray-400 hover:text-red-600"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        {adding && (
          <div className="mt-2 flex flex-col gap-2 rounded border border-gray-200 p-2">
            <ul role="listbox" className="flex flex-col rounded border border-gray-200 bg-white">
              {relations.map((rel) => (
                <li key={`${rel.relation}-${rel.direction}`}>
                  <button
                    role="option"
                    aria-selected={pickRelation?.label === rel.label}
                    onClick={() => setPickRelation(rel)}
                    className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-gray-50 ${
                      pickRelation?.label === rel.label ? "bg-blue-50 font-medium text-blue-700" : ""
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
      </div>

      <div className="mt-6 flex gap-2">
        <button onClick={save} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white">
          Save
        </button>
        <button onClick={remove} className="rounded bg-red-50 px-4 py-1.5 text-sm font-medium text-red-700">
          Delete
        </button>
      </div>
    </Drawer>
  );
}

// A single docked panel. The full-screen backdrop is owned by the parent so
// multiple panels can sit side by side in one right-docked row.
function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <aside
      className="flex h-full w-96 shrink-0 flex-col border-l bg-white shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex justify-end border-b px-2 py-1.5">
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded px-2 py-0.5 text-lg leading-none text-gray-400 hover:text-gray-700"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
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
        className="w-full rounded border border-gray-200 px-2 py-1 text-left text-sm disabled:opacity-50"
      >
        Choose item…
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded border border-gray-200 bg-white p-1 shadow">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="mb-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
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
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-gray-50"
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
