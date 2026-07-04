import { useState } from "react";
import type { ItemKind } from "../types";
import { btnGhost, inputClass, modalPanelClass, overlayClass } from "./ui";

const KIND_LABEL: Record<ItemKind, string> = {
  feature: "feature",
  story: "story",
  risk: "risk",
};

/** Small centered creation dialog (replaces window.prompt): one autofocused
 *  title input; Enter/Create submits when non-blank, Escape/Cancel closes. */
export default function NewItemDialog({
  kind,
  onCreate,
  onClose,
}: {
  kind: ItemKind;
  onCreate: (title: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const valid = title.trim().length > 0;
  const submit = () => {
    if (valid) void onCreate(title.trim());
  };
  return (
    <div
      className={`${overlayClass} z-40`}
      role="dialog"
      aria-label={`New ${KIND_LABEL[kind]}`}
      onClick={onClose}
    >
      <div className={`${modalPanelClass} max-w-md`} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-sm font-semibold capitalize text-gray-900">
          New {KIND_LABEL[kind]}
        </h2>
        <input
          autoFocus
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Title…"
          className={`w-full ${inputClass}`}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
