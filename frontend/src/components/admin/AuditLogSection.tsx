import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import { getAuditEvents } from "../../api/client";
import { faScroll } from "../../icons";
import type { AuditEvent } from "../../types";

const PAGE = 50;

const ENTITY_TYPES = [
  "item", "link", "import", "team", "team_member",
  "planning_interval", "capacity", "lane", "board", "user", "auth",
];

function changeCell(event: AuditEvent): string {
  if (event.field) return `${event.field}: ${event.old_value ?? "—"} → ${event.new_value ?? "—"}`;
  return event.new_value ?? event.old_value ?? "—";
}

export default function AuditLogSection() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [entityType, setEntityType] = useState("");

  const fetchPage = (offset: number, append: boolean, isStale?: () => boolean) =>
    void getAuditEvents({ limit: PAGE, offset, q, entity_type: entityType }).then((page) => {
      if (isStale?.()) return; // a newer filter state superseded this request
      setTotal(page.total);
      setEvents((prev) => (append ? [...prev, ...page.items] : page.items));
    });

  // Filters reset to the first page. fetchPage reads q/entityType from this
  // render's closure, so listing it in deps would only add noise — the two
  // real inputs are already the dependencies.
  useEffect(() => {
    let stale = false;
    fetchPage(0, false, () => stale);
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, entityType]);

  return (
    <section className="rounded-2xl border border-gray-200 bg-surface p-5 shadow-xs ring-1 ring-black/5">
      <header className="mb-4 flex flex-wrap items-center gap-2.5">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-base text-indigo-600"
          aria-hidden
        >
          <FontAwesomeIcon icon={faScroll} />
        </span>
        <h2 className="text-sm font-semibold text-gray-900">Audit Log</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
          {total}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by actor, entity, or event…"
            className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm transition focus:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
          />
          <select
            aria-label="Entity type"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="rounded-lg border border-gray-300 bg-surface px-2 py-1.5 text-sm transition focus:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
          >
            <option value="">All types</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-2 pr-3 font-semibold">Time</th>
              <th className="px-2 py-2 font-semibold">Actor</th>
              <th className="px-2 py-2 font-semibold">Event</th>
              <th className="px-2 py-2 font-semibold">Entity</th>
              <th className="px-2 py-2 font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-gray-100 last:border-0">
                <td className="whitespace-nowrap py-2 pr-3 text-gray-500">
                  {new Date(event.created_at).toLocaleString()}
                </td>
                <td className="px-2 py-2 text-gray-700">{event.actor_name ?? "—"}</td>
                <td className="px-2 py-2 font-mono text-xs text-gray-600">{event.event_type}</td>
                <td className="px-2 py-2 text-gray-700">
                  {event.entity_label ?? "—"}
                  {event.entity_id != null ? ` #${event.entity_id}` : ""}
                </td>
                <td className="px-2 py-2 text-gray-600">{changeCell(event)}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-gray-400">
                  No audit events.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {events.length < total && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => fetchPage(events.length, true)}
            className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
          >
            Load more
          </button>
        </div>
      )}
    </section>
  );
}
