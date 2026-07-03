import { useState } from "react";
import type { ItemKind } from "../types";

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
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
      role="dialog"
      aria-label={`New ${KIND_LABEL[kind]}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
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
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
