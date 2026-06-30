import { useEffect, useState } from "react";
import { createItem, deleteItem, getItem, updateItem } from "../api/client";
import type { Item, ItemUpdate } from "../types";
import Field from "./Field";
import SearchableSelect from "./SearchableSelect";

const NUMERIC_FIELDS = new Set([
  "story_points", "business_value", "time_criticality",
  "risk_reduction", "job_size",
]);

export default function ItemDrawer({
  itemId,
  assigneeOptions = [],
  onClose,
  onChanged,
  onBack,
  onOpenParent,
}: {
  itemId: number;
  assigneeOptions?: string[];
  onClose: () => void;
  onChanged: () => void;
  onBack?: () => void;
  onOpenParent?: (parentId: number) => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [parent, setParent] = useState<Item | null>(null);
  const [draft, setDraft] = useState<ItemUpdate>({});
  const [error, setError] = useState<string | null>(null);

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

  if (error) return <Drawer onClose={onClose} onBack={onBack}><p className="text-red-600">{error}</p></Drawer>;
  if (!item) return <Drawer onClose={onClose} onBack={onBack}><p>Loading…</p></Drawer>;

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

  return (
    <Drawer onClose={onClose} onBack={onBack}>
      <div className="mb-4 flex items-center justify-between">
        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
          {item.type ?? item.kind}
        </span>
        {item.wsjf_score != null && (
          <span className="text-sm font-semibold text-gray-700">
            WSJF {item.wsjf_score}
          </span>
        )}
      </div>

      {item.kind === "story" && item.parent_id != null && onOpenParent && (
        <div className="mb-4 rounded bg-blue-50 px-3 py-2">
          <span className="block text-xs font-medium text-gray-500">Parent feature</span>
          <button
            onClick={() => onOpenParent(item.parent_id!)}
            className="mt-0.5 block max-w-full truncate text-left text-sm font-medium text-blue-700 hover:underline"
          >
            {parent ? parent.title : `#${item.parent_id}`}
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <Field label="Title" value={value("title")} onChange={(v) => set("title", v)} />
        <Field label="Status" value={value("status")} onChange={(v) => set("status", v)} />
        <Field label="Iteration" value={value("iteration")} onChange={(v) => set("iteration", v)} />
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
                className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm"
              >
                <span>{child.title}</span>
                <button
                  aria-label={`remove story ${child.id}`}
                  onClick={() => removeStory(child.id)}
                  className="text-gray-400 hover:text-red-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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

function Drawer({
  children,
  onClose,
  onBack,
}: {
  children: React.ReactNode;
  onClose: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="h-full w-96 overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {onBack && (
          <button
            onClick={onBack}
            className="mb-3 -ml-1 flex items-center gap-1 rounded px-1 py-0.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            ← Back
          </button>
        )}
        {children}
      </aside>
    </div>
  );
}
