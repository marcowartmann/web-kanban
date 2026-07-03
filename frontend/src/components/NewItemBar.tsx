import { useState } from "react";
import { createItem } from "../api/client";
import type { ItemKind } from "../types";
import NewItemDialog from "./NewItemDialog";
import { btnDanger, btnPrimary } from "./ui";

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
      <button onClick={() => setDialogKind("feature")} className={btnPrimary}>
        + New Feature
      </button>
      <button onClick={() => setDialogKind("risk")} className={btnDanger}>
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
