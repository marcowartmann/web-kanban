import { useState } from "react";
import { createItem } from "../api/client";
import type { ItemKind } from "../types";
import NewItemDialog from "./NewItemDialog";

export default function NewItemBar({ onCreated }: { onCreated: () => void }) {
  const [dialogKind, setDialogKind] = useState<ItemKind | null>(null);

  const create = async (title: string) => {
    if (!dialogKind) return;
    await createItem({ kind: dialogKind, title, status: "Funnel" });
    setDialogKind(null);
    onCreated();
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={() => setDialogKind("feature")}
        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
      >
        + New Feature
      </button>
      <button
        onClick={() => setDialogKind("risk")}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-200"
      >
        + New Risk
      </button>
      {dialogKind && (
        <NewItemDialog
          kind={dialogKind}
          onCreate={create}
          onClose={() => setDialogKind(null)}
        />
      )}
    </div>
  );
}
