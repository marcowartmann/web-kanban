import { useEffect, useState } from "react";
import { getItemEvents } from "../api/client";
import type { AuditEvent } from "../types";

function describe(event: AuditEvent): string {
  switch (event.event_type) {
    case "item.created":
      return "created this item";
    case "item.updated":
      return `changed ${event.field}: ${event.old_value ?? "—"} → ${event.new_value ?? "—"}`;
    case "link.added":
      return `added link ${event.new_value ?? ""}`;
    case "link.removed":
      return `removed link ${event.old_value ?? ""}`;
    default:
      return event.event_type;
  }
}

export default function ItemActivity({ itemId }: { itemId: number }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    let stale = false;
    setEvents([]); // don't show the previous item's history while loading
    // Errors degrade to the empty state — activity must never break the drawer.
    getItemEvents(itemId)
      .then((rows) => {
        if (!stale) setEvents(rows);
      })
      .catch(() => {
        if (!stale) setEvents([]);
      });
    return () => {
      stale = true;
    };
  }, [itemId]);

  if (events.length === 0) {
    return <p className="text-xs text-gray-400">No activity yet.</p>;
  }
  return (
    <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
      {events.map((event) => (
        <li key={event.id} className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">{event.actor_name ?? "System"}</span>
          <span className="text-gray-400"> · {new Date(event.created_at).toLocaleString()}</span>
          <div>{describe(event)}</div>
        </li>
      ))}
    </ul>
  );
}
