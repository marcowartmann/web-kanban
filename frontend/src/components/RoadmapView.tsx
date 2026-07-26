import { useCallback, useEffect, useMemo, useState } from "react";
import { createStream, deleteStream, getProductRoadmap, getProducts, updateStream } from "../api/client";
import { assignRows, axisRange, barGeometry } from "../lib/roadmap";
import PageHeader from "../shell/PageHeader";
import type { Product, RoadmapItem, RoadmapStatus, Stream } from "../types";
import ConfirmDialog from "./ConfirmDialog";
import FilterSelect from "./FilterSelect";
import RoadmapItemDrawer from "./RoadmapItemDrawer";
import { btnDangerGhost, btnGhost, btnSecondary, inputClass } from "./ui";

// Bar stacking: each overlap row is 32px tall (24px bar + 8px gap), lanes
// carry 8px padding above and below the rows.
const BAR_ROW_PX = 32;
const BAR_PAD_PX = 8;

const STATUS_CLASSES: Record<RoadmapStatus, string> = {
  idea: "bg-gray-200 text-gray-700",
  planned: "bg-blue-100 text-blue-800",
  committed: "bg-violet-100 text-violet-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-100 text-gray-400 line-through",
};

/** Top-level Gantt-style roadmap: per-product streams (lanes) holding
 *  date-ranged items rendered as status-colored bars against a shared month
 *  axis. Mirrors CatalogSection's run()-style error helper for mutations and
 *  LifecycleView's loading-before-empty shell. */
export default function RoadmapView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productName, setProductName] = useState<string | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingStream, setAddingStream] = useState(false);
  const [newStreamName, setNewStreamName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RoadmapItem | null>(null);
  const [defaultStreamId, setDefaultStreamId] = useState<number | null>(null);

  useEffect(() => {
    void getProducts()
      .then((list) => {
        setProducts(list);
        setProductName((current) => current ?? list[0]?.name ?? null);
        // No product means the streams-loading effect below never fires (and
        // never clears the spinner) — stop it here instead.
        if (list.length === 0) setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load products");
        setLoading(false);
      });
  }, []);

  const product = products.find((p) => p.name === productName) ?? null;

  const loadStreams = useCallback(async () => {
    if (!product) return;
    setStreams(await getProductRoadmap(product.id));
  }, [product]);

  useEffect(() => {
    if (!product) return;
    setLoading(true);
    void loadStreams()
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load roadmap"))
      .finally(() => setLoading(false));
    // Only the product identity should re-trigger the initial (loading-gated)
    // fetch; loadStreams itself is used bare (no loading flip) after mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    }
    try {
      await loadStreams();
    } catch {
      setError("Saved, but refreshing the roadmap failed — reload the page.");
      return false;
    }
    return true;
  };

  const allItems = useMemo(() => streams.flatMap((s) => s.items), [streams]);
  const range = useMemo(() => axisRange(allItems, new Date()), [allItems]);

  const addStream = async () => {
    const name = newStreamName.trim();
    let created = false;
    const ok = await run(async () => {
      if (!name || !product) return;
      await createStream(name, product.id);
      created = true;
      setNewStreamName("");
    });
    // Keep the row open on error (or a no-op blank submit) so the user can retry.
    if (ok && created) setAddingStream(false);
  };

  const moveStream = (index: number, direction: -1 | 1) =>
    run(async () => {
      const current = streams[index];
      const other = streams[index + direction];
      if (!current || !other) return;
      // Write positions derived from display index (not the stored values
      // being swapped) so the two calls are always distinct — even from an
      // already-corrupted state where a prior partial swap left two streams
      // sharing a position — and a failure of the second call can't wedge
      // the order permanently.
      await updateStream(current.id, { position: index + direction });
      await updateStream(other.id, { position: index });
    });

  const commitRename = () =>
    run(async () => {
      if (!renaming) return;
      const name = renaming.name.trim();
      if (name) await updateStream(renaming.id, { name });
      setRenaming(null);
    });

  const openCreate = (streamId: number) => {
    setEditing(null);
    setDefaultStreamId(streamId);
    setDrawerOpen(true);
  };

  const openEdit = (item: RoadmapItem) => {
    setEditing(item);
    setDefaultStreamId(null);
    setDrawerOpen(true);
  };

  const gridlines = (
    <>
      {range.months.map((m) => (
        <div
          key={m.label}
          aria-hidden
          className="absolute top-0 h-full border-l border-gray-100"
          style={{ left: `${m.leftPct}%` }}
        />
      ))}
      {range.todayPct != null && (
        <div
          aria-hidden
          title="Today"
          className="absolute top-0 h-full w-px bg-red-500"
          style={{ left: `${range.todayPct}%` }}
        />
      )}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Roadmap"
        actions={
          product && (
            <button className={btnSecondary} onClick={() => setAddingStream((v) => !v)}>
              + Add stream
            </button>
          )
        }
      />
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-surface px-6 py-3">
        <FilterSelect
          label="Product"
          value={productName ?? undefined}
          options={products.map((p) => p.name)}
          onChange={(v) => setProductName(v ?? null)}
          allowAll={false}
        />
      </div>

      {error && (
        <div className="shrink-0 px-6 pt-3">
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {!loading && addingStream && product && (
          <div className="mb-4 flex items-center gap-2">
            <input
              autoFocus
              placeholder="New stream name"
              value={newStreamName}
              onChange={(e) => setNewStreamName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addStream()}
              className={inputClass}
            />
            <button onClick={() => void addStream()} className={btnSecondary}>
              Add stream
            </button>
          </div>
        )}
        {loading ? (
          <div className="text-gray-500">Loading…</div>
        ) : streams.length === 0 ? (
          <div className="px-2 py-8 text-sm text-gray-400">
            No streams yet. Add one to start the roadmap.
          </div>
        ) : (
          <>
            <div className="flex">
              <div className="w-56 shrink-0" />
              <div className="relative h-8 flex-1 border-b border-gray-200">
                {range.months.map((m) => (
                  <div
                    key={m.label}
                    className="absolute top-0 h-full border-l border-gray-100 pl-1 text-xs text-gray-400"
                    style={{ left: `${m.leftPct}%` }}
                  >
                    {m.label}
                  </div>
                ))}
                {range.todayPct != null && (
                  <div
                    aria-hidden
                    title="Today"
                    className="absolute top-0 h-full w-px bg-red-500"
                    style={{ left: `${range.todayPct}%` }}
                  />
                )}
              </div>
            </div>

            {streams.map((stream, index) => {
              const laneRows = assignRows(stream.items);
              return (
              <div key={stream.id} className="flex border-b border-gray-100 py-1.5">
                <div className="flex w-56 shrink-0 flex-col gap-1 pr-3">
                  {renaming?.id === stream.id ? (
                    <input
                      autoFocus
                      aria-label={`Rename ${stream.name}`}
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: stream.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className={inputClass}
                    />
                  ) : (
                    <span className="truncate text-sm font-medium text-gray-800">{stream.name}</span>
                  )}
                  <div className="flex items-center gap-1">
                    <button
                      aria-label={`Move ${stream.name} up`}
                      disabled={index === 0}
                      onClick={() => void moveStream(index, -1)}
                      className={`${btnGhost} px-1.5 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-30`}
                    >
                      ▲
                    </button>
                    <button
                      aria-label={`Move ${stream.name} down`}
                      disabled={index === streams.length - 1}
                      onClick={() => void moveStream(index, 1)}
                      className={`${btnGhost} px-1.5 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-30`}
                    >
                      ▼
                    </button>
                    <button
                      aria-label={`Rename ${stream.name}`}
                      onClick={() => setRenaming({ id: stream.id, name: stream.name })}
                      className={`${btnGhost} px-1.5 py-0.5 text-xs`}
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Delete ${stream.name}`}
                      onClick={() => setConfirmDelete({ id: stream.id, name: stream.name })}
                      className={`${btnDangerGhost} px-1.5 py-0.5 text-xs`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div
                  className="relative flex-1"
                  style={{ minHeight: `${laneRows.rowCount * BAR_ROW_PX + 2 * BAR_PAD_PX}px` }}
                >
                  {gridlines}
                  {stream.items.map((item) => {
                    const g = barGeometry(item, range);
                    // Overlapping ranges stack on separate rows so every bar
                    // stays readable and clickable.
                    const row = laneRows.rows.get(item.id) ?? 0;
                    return (
                      <button
                        key={item.id}
                        title={`${item.title}: ${item.start_date} → ${item.end_date}`}
                        onClick={() => openEdit(item)}
                        className={`absolute h-6 truncate rounded px-2 text-left text-xs font-medium ${STATUS_CLASSES[item.status]}`}
                        style={{
                          left: `${g.leftPct}%`,
                          width: `${g.widthPct}%`,
                          top: `${BAR_PAD_PX + row * BAR_ROW_PX}px`,
                        }}
                      >
                        {item.title}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => openCreate(stream.id)}
                    className={`${btnGhost} absolute right-1 top-1 px-1.5 py-0.5 text-xs`}
                  >
                    Add item
                  </button>
                </div>
              </div>
              );
            })}
          </>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete stream"
          message={`Delete “${confirmDelete.name}”? Streams with roadmap items can't be deleted.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            const { id } = confirmDelete;
            setConfirmDelete(null);
            await run(() => deleteStream(id));
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {drawerOpen && (
        <RoadmapItemDrawer
          key={editing?.id ?? "new"}
          item={editing}
          streams={streams}
          defaultStreamId={defaultStreamId}
          onClose={() => setDrawerOpen(false)}
          onChanged={async () => {
            await loadStreams();
          }}
        />
      )}
    </div>
  );
}
