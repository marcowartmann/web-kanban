import { createItem } from "../api/client";
import type { ItemKind } from "../types";

export default function NewItemBar({ onCreated }: { onCreated: () => void }) {
  const add = async (kind: ItemKind) => {
    const title = window.prompt(`New ${kind} title`);
    if (!title) return;
    await createItem({ kind, title, status: "Funnel" });
    onCreated();
  };
  return (
    <div className="flex gap-2">
      <button
        onClick={() => add("feature")}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
      >
        + New Feature
      </button>
      <button
        onClick={() => add("risk")}
        className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
      >
        + New Risk
      </button>
    </div>
  );
}
