import { useEffect, useRef, useState } from "react";
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
import type { Container, Department, Item, ItemKind, ItemUpdate, PersonOption, RelationOption, Team } from "../types";
import Avatar from "./Avatar";
import ConfirmDialog from "./ConfirmDialog";
import Field from "./Field";
import InlineAddInput from "./InlineAddInput";
import ItemActivity from "./ItemActivity";
import ItemComments from "./ItemComments";
import PlainSelect from "./PlainSelect";
import WsjfToggle from "./WsjfToggle";

const NUMERIC_FIELDS = new Set([
  "story_points",
  "business_value",
  "time_criticality",
  "risk_reduction",
  "job_size",
]);

const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

const KIND_CHIP: Record<string, string> = {
  feature: "bg-blue-100 text-blue-700",
  story: "bg-slate-200 text-slate-700",
  risk: "bg-red-100 text-red-700",
};
// Soft kind-tinted band fading into the panel body.
const KIND_BAND: Record<string, string> = {
  feature: "bg-linear-to-b from-blue-50/90 via-blue-50/40 to-surface",
  story: "bg-linear-to-b from-slate-100/90 via-slate-50/40 to-surface",
  risk: "bg-linear-to-b from-red-50/90 via-red-50/40 to-surface",
};

const withCurrent = (current: string | null, options: string[]): string[] =>
  current && !options.includes(current) ? [current, ...options] : options;

export default function ItemDrawer({
  itemId,
  compact = false,
  people = [],
  statusOptionsByKind = {},
  planningIntervalOptions = [],
  leadingTeamOptions = [],
  containers = [],
  departments = [],
  teams = [],
  openIds = [],
  onClose,
  onChanged,
  onOpenParent,
  onOpenChild,
  onOpenItem,
  onLinksChanged,
}: {
  itemId: number;
  compact?: boolean;
  people?: PersonOption[];
  statusOptionsByKind?: Partial<Record<ItemKind, string[]>>;
  planningIntervalOptions?: string[];
  leadingTeamOptions?: string[];
  containers?: Container[];
  departments?: Department[];
  teams?: Team[];
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
  const [addingStory, setAddingStory] = useState(false);
  const [pickRelation, setPickRelation] = useState<RelationOption | null>(null);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [activityVisited, setActivityVisited] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    void getLinkRelations().then(setRelations).catch(() => undefined);
    void listItems().then(setCandidates).catch(() => undefined);
  }, []);

  useEffect(() => {
    setConflict(null);
    void getItem(itemId).then(setItem).catch((e) => setError(String(e)));
  }, [itemId]);

  // For stories, load the parent feature so we can show a breadcrumb to it.
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

  const addStory = async (title: string) => {
    await createItem({ kind: "story", title, parent_id: itemId });
    setAddingStory(false);
    await reloadItem();
  };

  const removeStory = async (storyId: number) => {
    await deleteItem(storyId);
    await reloadItem();
  };

  if (error)
    return (
      <Drawer compact={compact}>
        <CloseBar onClose={onClose} />
        <p className="p-6 text-sm text-red-600">{error}</p>
      </Drawer>
    );
  if (!item)
    return (
      <Drawer compact={compact}>
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

  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    try {
      const updated = await updateItem(item.id, { ...draft, version: item.version });
      setConflict(null);
      setItem(updated);
      setDraft({});
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
    await deleteItem(item.id);
    onChanged();
  };

  // Only offer the parent breadcrumb when the parent isn't already open beside us.
  const showParentLink =
    item.kind === "story" &&
    item.parent_id != null &&
    onOpenParent != null &&
    !openIds.includes(item.parent_id);

  const children = item.children ?? [];
  const currentPerson =
    people.find((p) => p.id === (value("assignee_id") as number | null)) ?? null;
  const assigneeName = currentPerson?.display_name ?? (item.assignee || null);

  const properties = (
    <>
      <PropLabel text="Status">
        <PlainSelect
          ariaLabel="Status"
          value={(value("status") as string | null) || null}
          options={withCurrent(
            (value("status") as string | null) || null,
            statusOptionsByKind[item.kind] ?? [],
          )}
          onChange={(v) => setDraft((d) => ({ ...d, status: v ?? "" }))}
          placeholder="Select status…"
        />
      </PropLabel>
      <PropLabel text="Planning Interval">
        <PlainSelect
          ariaLabel="Planning Interval"
          value={(value("planning_interval") as string | null) || null}
          options={withCurrent(
            (value("planning_interval") as string | null) || null,
            planningIntervalOptions,
          )}
          onChange={(v) => setDraft((d) => ({ ...d, planning_interval: v ?? "" }))}
          placeholder="Select planning interval…"
        />
      </PropLabel>
      <PropLabel text="Leading Team">
        <PlainSelect
          ariaLabel="Leading Team"
          value={(value("leading_team") as string | null) || null}
          options={withCurrent((value("leading_team") as string | null) || null, leadingTeamOptions)}
          onChange={(v) => setDraft((d) => ({ ...d, leading_team: v ?? "" }))}
          placeholder="Select team…"
        />
      </PropLabel>
      <PropLabel text="Container">
        {(() => {
          // Containers are scoped to the draft-aware PI + leading team, so
          // changing either immediately rescopes the options.
          const scopePi = (value("planning_interval") as string | null) || null;
          const scopeTeamName = (value("leading_team") as string | null) || null;
          const scopeTeam = teams.find((t) => t.name === scopeTeamName) ?? null;
          if (!scopePi || !scopeTeam) {
            return (
              <p className="py-1.5 text-sm text-gray-400">
                Set planning interval and leading team first
              </p>
            );
          }
          const scoped = containers.filter(
            (c) => c.planning_interval === scopePi && c.team_id === scopeTeam.id,
          );
          const currentId = value("container_id") as number | null;
          return (
            <PlainSelect
              ariaLabel="Container"
              value={scoped.find((c) => c.id === currentId)?.name ?? null}
              options={scoped.map((c) => c.name)}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  container_id: v == null ? null : scoped.find((c) => c.name === v)?.id ?? null,
                }))
              }
              placeholder="Select container…"
            />
          );
        })()}
      </PropLabel>
      {item.kind !== "risk" && (
        <PropLabel text="Department">
          {(() => {
            const teamName = (value("leading_team") as string | null) || null;
            if (!teamName) {
              return <p className="py-1.5 text-sm text-gray-400">Set a leading team first</p>;
            }
            const scoped = departments.filter((d) => d.team_name === teamName);
            const currentId = value("department_id") as number | null;
            return (
              <PlainSelect
                ariaLabel="Department"
                value={scoped.find((d) => d.id === currentId)?.name ?? null}
                options={scoped.map((d) => d.name)}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    department_id: v == null ? null : scoped.find((x) => x.name === v)?.id ?? null,
                  }))
                }
                placeholder="Select department…"
              />
            );
          })()}
        </PropLabel>
      )}
      <PropLabel text="Supporting Team">
        <PlainSelect
          ariaLabel="Supporting Team"
          value={(value("supporting_team") as string | null) || null}
          options={withCurrent(
            (value("supporting_team") as string | null) || null,
            leadingTeamOptions,
          )}
          onChange={(v) => setDraft((d) => ({ ...d, supporting_team: v ?? "" }))}
          placeholder="Select team…"
        />
      </PropLabel>
      <PropLabel text="Assignee">
        {(() => {
          // Prefilter people to the chosen leading team (draft-aware); the
          // current assignee stays selectable even if outside that team.
          const teamName = (value("leading_team") as string | null) || null;
          const team = teamName ? teams.find((t) => t.name === teamName) ?? null : null;
          const scoped = team ? people.filter((p) => p.team_id === team.id) : people;
          return (
            <div className="flex items-center gap-2">
              {assigneeName && <Avatar name={assigneeName} />}
              <div className="min-w-0 flex-1">
                <PlainSelect
                  ariaLabel="Assignee"
                  value={assigneeName}
                  options={withCurrent(assigneeName, scoped.map((p) => p.display_name))}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      assignee_id:
                        v == null ? null : people.find((p) => p.display_name === v)?.id ?? null,
                    }))
                  }
                  placeholder="Select person…"
                />
              </div>
            </div>
          );
        })()}
      </PropLabel>
      <PropLabel text="T-Shirt Size">
        <PlainSelect
          ariaLabel="T-Shirt Size"
          value={(value("tshirt_size") as string | null) || null}
          options={withCurrent((value("tshirt_size") as string | null) || null, TSHIRT_SIZES)}
          onChange={(v) => setDraft((d) => ({ ...d, tshirt_size: v ?? "" }))}
          placeholder="Select size…"
        />
      </PropLabel>
      <Field
        label="Stakeholder"
        value={value("bo_stakeholder")}
        onChange={(v) => set("bo_stakeholder", v)}
      />
      {/* col-span-2 lets the block take the full width of the compact grid;
          it is inert in the wide mode's block-layout rail. */}
      <div className="col-span-2 border-t border-gray-200 pt-4">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Estimation
        </h3>
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
          <Field
            label="Story Points"
            type="number"
            value={value("story_points")}
            onChange={(v) => set("story_points", v)}
          />
        )}
      </div>
    </>
  );

  const content = (
    <>
      <NarrativeText
        label="Description"
        placeholder="Add a description…"
        value={(value("description") as string | null) ?? ""}
        onChange={(v) => set("description", v)}
      />
      <NarrativeText
        label="Acceptance criteria"
        placeholder="Add acceptance criteria…"
        value={(value("akzeptanzkriterien") as string | null) ?? ""}
        onChange={(v) => set("akzeptanzkriterien", v)}
      />
      <NarrativeText
        label="Definition of Done"
        placeholder="Add a definition of done…"
        value={(value("definition_of_done") as string | null) ?? ""}
        onChange={(v) => set("definition_of_done", v)}
      />

      {item.kind === "feature" && (
        <Section
          label={`Stories · ${children.length}`}
          action={
            !addingStory && (
              <button
                onClick={() => setAddingStory(true)}
                className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
              >
                + Add story
              </button>
            )
          }
        >
          <ul className="flex flex-col gap-1.5">
            {children.map((child) => (
              <li
                key={child.id}
                className={`group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                  openIds.includes(child.id)
                    ? "border-blue-200 bg-blue-50"
                    : "border-gray-100 bg-gray-50 hover:border-gray-200 hover:bg-gray-100"
                }`}
              >
                {onOpenChild ? (
                  <button
                    onClick={() => onOpenChild(child.id)}
                    className="min-w-0 flex-1 truncate text-left font-medium text-gray-800 hover:text-blue-700 hover:underline"
                  >
                    {child.title}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                )}
                {child.status && (
                  <span className="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">
                    {child.status}
                  </span>
                )}
                {child.story_points != null && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                    {child.story_points} SP
                  </span>
                )}
                <button
                  aria-label={`remove story ${child.id}`}
                  onClick={() => removeStory(child.id)}
                  className="shrink-0 rounded-sm p-0.5 text-gray-300 transition hover:bg-surface hover:text-red-600 group-hover:text-gray-400"
                >
                  ✕
                </button>
              </li>
            ))}
            {addingStory && (
              <li>
                <InlineAddInput
                  ariaLabel="New story title"
                  placeholder="Story title — Enter to add, Esc to cancel"
                  onSubmit={addStory}
                  onCancel={() => setAddingStory(false)}
                />
              </li>
            )}
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
              className="group flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 text-sm transition hover:border-gray-200 hover:bg-gray-100"
            >
              <button
                onClick={() => onOpenItem?.(link.item.id)}
                className="min-w-0 flex-1 truncate text-left"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {link.label}
                </span>{" "}
                <span className="font-medium text-gray-800 hover:text-blue-700 hover:underline">
                  {link.item.title}
                </span>
                <span className="ml-1 text-xs text-gray-400">({link.item.kind})</span>
              </button>
              <button
                aria-label={`remove link ${link.link_id}`}
                onClick={() => removeLink(link.link_id)}
                className="ml-2 shrink-0 rounded-sm p-0.5 text-gray-300 transition hover:bg-surface hover:text-red-600 group-hover:text-gray-400"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>

        {adding && (
          <div className="mt-2 flex flex-col gap-2.5 rounded-xl bg-gray-50 p-3 ring-1 ring-black/5">
            <ul role="listbox" className="flex flex-wrap gap-1.5">
              {relations.map((rel) => (
                <li key={`${rel.relation}-${rel.direction}`}>
                  <button
                    role="option"
                    aria-selected={pickRelation?.label === rel.label}
                    onClick={() => setPickRelation(rel)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      pickRelation?.label === rel.label
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-surface text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100"
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

      <section>
        <div role="tablist" className="mb-3 flex w-fit gap-0.5 rounded-lg bg-gray-100 p-0.5">
          <TabButton selected={tab === "comments"} onClick={() => setTab("comments")}>
            Comments
          </TabButton>
          <TabButton
            selected={tab === "activity"}
            onClick={() => {
              setTab("activity");
              setActivityVisited(true);
            }}
          >
            Activity
          </TabButton>
        </div>
        <div hidden={tab !== "comments"}>
          <ItemComments itemId={item.id} />
        </div>
        {(activityVisited || tab === "activity") && (
          <div hidden={tab !== "activity"}>
            <ItemActivity itemId={item.id} />
          </div>
        )}
      </section>
    </>
  );

  return (
    <Drawer
      compact={compact}
      footer={
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-gray-400">Unsaved changes</span>}
          <button
            onClick={save}
            disabled={!dirty}
            className="ml-auto rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-200 disabled:cursor-default disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
          >
            Save
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      }
    >
      {/* Sticky header: kind-tinted band, chips row, breadcrumb (stories), title, conflict. */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-surface">
        <div className={KIND_BAND[item.kind] ?? "bg-surface"}>
          <div className="flex items-center justify-between gap-2 px-5 pt-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${KIND_CHIP[item.kind] ?? "bg-gray-100 text-gray-700"}`}
              >
                {item.type ?? item.kind}
              </span>
              <button
                aria-label="copy id"
                title="Copy id"
                onClick={() => void navigator.clipboard?.writeText(`#${item.id}`)}
                className="shrink-0 rounded-sm px-0.5 text-xs text-gray-400 transition hover:text-gray-600"
              >
                #{item.id}
              </button>
              {item.wsjf_score != null && (
                <span className="shrink-0 rounded-full bg-amber-100/80 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  WSJF {item.wsjf_score}
                </span>
              )}
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-surface/70 hover:text-gray-700"
            >
              ✕
            </button>
          </div>
          {showParentLink && (
            <button
              onClick={() => onOpenParent!(item.parent_id!)}
              className="group mx-5 mt-1.5 flex max-w-full items-center gap-1.5 text-xs"
            >
              <span className="shrink-0 font-semibold uppercase tracking-wide text-gray-400">
                Parent feature
              </span>
              <span aria-hidden className="text-gray-300">
                ❯
              </span>
              <span className="truncate font-medium text-blue-600 group-hover:underline">
                {parent ? parent.title : `#${item.parent_id}`}
              </span>
            </button>
          )}
          <div className="px-4 pb-3 pt-1">
            <GrowingTextarea
              ariaLabel="Title"
              value={(value("title") as string) ?? ""}
              onChange={(v) => set("title", v)}
              placeholder="Title"
              className="w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-1 text-lg font-semibold leading-snug text-gray-900 transition hover:bg-surface/60 focus:border-blue-400 focus:bg-surface focus:outline-hidden focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {conflict && (
            <p className="px-4 pb-2 text-xs font-medium text-amber-700">{conflict}</p>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete item?"
          message={`“${item.title}” and any child stories will be permanently deleted.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setConfirmingDelete(false)}
        />
      )}

      {compact ? (
        <div className="space-y-6 p-5">
          <div className="grid grid-cols-2 items-start gap-x-3 gap-y-4">{properties}</div>
          {content}
        </div>
      ) : (
        <div className="flex min-h-full items-stretch">
          <div className="min-w-0 flex-1 space-y-6 p-5">{content}</div>
          <aside className="w-56 shrink-0 space-y-4 border-l border-gray-100 bg-gray-50/60 p-4">
            {properties}
          </aside>
        </div>
      )}
    </Drawer>
  );
}

function PropLabel({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {text}
      </span>
      {children}
    </label>
  );
}

function NarrativeText({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </h3>
      <GrowingTextarea
        ariaLabel={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full resize-none rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-sm leading-relaxed text-gray-700 transition placeholder:text-gray-300 hover:bg-gray-50 focus:border-blue-400 focus:bg-surface focus:outline-hidden focus:ring-2 focus:ring-blue-100"
      />
    </section>
  );
}

function GrowingTextarea({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const grow = () => {
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    };
    grow();
    // Panel width changes (second panel opening/closing) re-wrap the text.
    // jsdom has no ResizeObserver; auto-grow is layout-only there anyway.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(grow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`overflow-hidden ${className ?? ""}`}
    />
  );
}

function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
        selected ? "bg-surface text-gray-900 shadow-xs" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
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
// multiple panels can sit side by side in one right-docked row. Width adapts:
// wide two-zone layout alone, compact column when panels share the row.
function Drawer({
  children,
  footer,
  compact = false,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <aside
      data-testid="item-panel"
      className={`flex h-full shrink-0 flex-col border-l border-gray-200 bg-surface shadow-xl ${
        compact ? "w-104" : "w-160"
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-gray-200 bg-surface px-5 py-3">{footer}</div>}
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
        className="w-full rounded-lg border border-gray-200 bg-surface px-2.5 py-1.5 text-left text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
      >
        Choose item…
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 bg-surface p-1 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="mb-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
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
