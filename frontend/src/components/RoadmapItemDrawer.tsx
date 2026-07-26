import { useEffect, useState } from "react";
import {
  createRoadmapItem,
  deleteRoadmapItem,
  linkRoadmapFeature,
  listItems,
  unlinkRoadmapFeature,
  updateRoadmapItem,
} from "../api/client";
import type { LinkedFeature, RoadmapItem, RoadmapStatus, Stream } from "../types";
import ConfirmDialog from "./ConfirmDialog";
import PlainSelect from "./PlainSelect";
import SearchableSelect from "./SearchableSelect";
import { btnDangerGhost, btnPrimary, btnSecondary, captionClass, inputClass } from "./ui";

const STATUSES: RoadmapStatus[] = ["idea", "planned", "committed", "done", "cancelled"];

/** Roadmap item create/edit drawer. `item == null` is create mode (POST);
 *  otherwise edit mode (PATCH, only-changed keys). Linked-features editing
 *  (edit mode only) commits immediately via linkRoadmapFeature/
 *  unlinkRoadmapFeature — each response is the fresh item, which refreshes
 *  the local features list independent of the Save button, mirroring
 *  ContractDrawer's linked-components editing. */
export default function RoadmapItemDrawer({
  item,
  streams,
  defaultStreamId,
  onClose,
  onChanged,
}: {
  item: RoadmapItem | null;
  streams: Stream[];
  defaultStreamId: number | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [allFeatures, setAllFeatures] = useState<LinkedFeature[]>([]);
  useEffect(() => {
    if (item != null) {
      void listItems({ kind: "feature" }).then((list) =>
        setAllFeatures(list.map((f) => ({ id: f.id, title: f.title, status: f.status }))),
      );
    }
  }, [item]);

  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [status, setStatus] = useState<RoadmapStatus>(item?.status ?? "idea");
  const [startDate, setStartDate] = useState(item?.start_date ?? "");
  const [endDate, setEndDate] = useState(item?.end_date ?? "");
  const [streamName, setStreamName] = useState<string | null>(
    streams.find((s) => s.id === (item?.stream_id ?? defaultStreamId))?.name ?? null,
  );
  const [features, setFeatures] = useState<LinkedFeature[]>(item?.features ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const featureLabel = (f: LinkedFeature) => `${f.title} (#${f.id})`;
  const linkedIds = new Set(features.map((f) => f.id));
  const addableFeatures = allFeatures.filter((f) => !linkedIds.has(f.id));

  const save = async () => {
    setError(null);
    if (startDate && endDate && startDate > endDate) {
      setError("Start date must not be after end date");
      return;
    }
    const streamId = streams.find((s) => s.name === streamName)?.id ?? null;
    try {
      if (item == null) {
        if (streamId == null) {
          setError("Stream is required");
          return;
        }
        await createRoadmapItem({
          title,
          stream_id: streamId,
          start_date: startDate,
          end_date: endDate,
          description: description || null,
          status,
        });
      } else {
        const changes: Parameters<typeof updateRoadmapItem>[1] = {};
        if (title !== item.title) changes.title = title;
        if (description !== (item.description ?? "")) changes.description = description || null;
        if (status !== item.status) changes.status = status;
        if (startDate !== item.start_date) changes.start_date = startDate;
        if (endDate !== item.end_date) changes.end_date = endDate;
        if (streamId != null && streamId !== item.stream_id) changes.stream_id = streamId;
        await updateRoadmapItem(item.id, changes);
      }
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const linkFeature = async (featureId: number) => {
    if (!item) return;
    setError(null);
    try {
      const fresh = await linkRoadmapFeature(item.id, featureId);
      setFeatures(fresh.features);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link feature");
    }
  };

  const unlinkFeature = async (featureId: number) => {
    if (!item) return;
    setError(null);
    try {
      const fresh = await unlinkRoadmapFeature(item.id, featureId);
      setFeatures(fresh.features);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlink feature");
    }
  };

  const remove = async () => {
    if (!item) return;
    setError(null);
    try {
      await deleteRoadmapItem(item.id);
      await onChanged();
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      setError(e instanceof Error ? e.message : "Delete blocked");
    }
  };

  return (
    <aside
      aria-label="Roadmap item drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-[26rem] flex-col overflow-y-auto border-l border-gray-200 bg-surface p-5 shadow-2xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          {item == null ? "New roadmap item" : "Edit roadmap item"}
        </h2>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>
      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <label className={captionClass}>Title</label>
      <input
        aria-label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Description</label>
      <textarea
        aria-label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Status</label>
      <div className="mb-3">
        <PlainSelect
          ariaLabel="Status"
          value={status}
          options={STATUSES}
          onChange={(v) => v && setStatus(v as RoadmapStatus)}
          clearable={false}
        />
      </div>
      <label className={captionClass}>Start date</label>
      <input
        type="date"
        aria-label="Start date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>End date</label>
      <input
        type="date"
        aria-label="End date"
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Stream</label>
      <div className="mb-4">
        <PlainSelect
          ariaLabel="Stream"
          value={streamName}
          options={streams.map((s) => s.name)}
          onChange={setStreamName}
          clearable={false}
        />
      </div>

      {item != null && (
        <>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Linked features</h3>
          <ul className="mb-2 flex flex-col gap-1.5">
            {features.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-sm"
              >
                <span className="flex-1 truncate text-gray-800">
                  {f.title}
                  {f.status && <span className="text-gray-400"> · {f.status}</span>}
                </span>
                <button
                  aria-label={`Unlink ${f.title}`}
                  onClick={() => void unlinkFeature(f.id)}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
            {features.length === 0 && <li className="text-sm text-gray-400">None</li>}
          </ul>
          <div className="mb-4">
            <SearchableSelect
              ariaLabel="Link feature"
              value={null}
              options={addableFeatures.map(featureLabel)}
              onChange={(picked) => {
                if (!picked) return;
                const target = addableFeatures.find((f) => featureLabel(f) === picked);
                if (target) void linkFeature(target.id);
              }}
              placeholder="Link feature…"
            />
          </div>
        </>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        {item != null ? (
          <button onClick={() => setConfirmDelete(true)} className={btnDangerGhost}>
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button onClick={() => void save()} className={btnPrimary}>
            Save
          </button>
        </div>
      </div>
      {confirmDelete && item != null && (
        <ConfirmDialog
          title="Delete roadmap item"
          message={`Delete “${item.title}”?`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </aside>
  );
}
