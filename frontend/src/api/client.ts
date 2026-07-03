import type {
  AuditEvent,
  AuthUser,
  Board,
  Capacity,
  Comment,
  ImportPreview,
  ImportResult,
  Item,
  ItemCreate,
  ItemUpdate,
  Lane,
  LinkRow,
  PersonOption,
  PlanningInterval,
  RelationOption,
  RestoreResult,
  SnapshotInfo,
  Team,
} from "../types";

/** Versioned API base. Breaking changes bump this (see the /api/v1 spec). */
export const API = "/api/v1";

let onUnauthorized: (() => void) | null = null;

/** Called on any 401 except login/getMe probes — lets the app flip back to the login screen. */
export function setUnauthorizedHandler(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

/** Thrown for HTTP 409 responses; `detail` is the server's conflict message. */
export class ConflictError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(detail);
    this.name = "ConflictError";
    this.detail = detail;
  }
}

async function request<T>(url: string, init?: RequestInit, notify401 = true): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    if (resp.status === 401 && notify401) onUnauthorized?.();
    const text = await resp.text();
    if (resp.status === 409) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        // non-JSON body — keep the raw text
      }
      throw new ConflictError(detail);
    }
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function listItems(params: Record<string, string> = {}): Promise<Item[]> {
  const out: Item[] = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ ...params, limit: "500", offset: String(offset) }).toString();
    const page = await request<{ items: Item[]; total: number }>(`${API}/items?${qs}`);
    out.push(...page.items);
    if (out.length >= page.total || page.items.length === 0) return out;
    offset = out.length;
  }
}

export function getItem(id: number): Promise<Item> {
  return request<Item>(`${API}/items/${id}`);
}

export function createItem(body: ItemCreate): Promise<Item> {
  return request<Item>(`${API}/items`, json(body));
}

export function updateItem(id: number, patch: ItemUpdate & { version: number }): Promise<Item> {
  return request<Item>(`${API}/items/${id}`, { ...json(patch), method: "PATCH" });
}

export function deleteItem(id: number): Promise<void> {
  return request<void>(`${API}/items/${id}`, { method: "DELETE" });
}

export function getLinkRelations(): Promise<RelationOption[]> {
  return request<RelationOption[]>(`${API}/link-relations`);
}

export function listLinks(): Promise<LinkRow[]> {
  return request<LinkRow[]>(`${API}/links`);
}

export function createLink(body: {
  source_id: number;
  target_id: number;
  relation: string;
}): Promise<LinkRow> {
  return request<LinkRow>(`${API}/links`, json(body));
}

export function deleteLink(linkId: number): Promise<void> {
  return request<void>(`${API}/links/${linkId}`, { method: "DELETE" });
}

export function previewImport(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  return request<ImportPreview>(`${API}/import/preview`, { method: "POST", body: form });
}

export function importCsv(file: File, stateStamp: string, fileSha256: string): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("state_stamp", stateStamp);
  form.append("file_sha256", fileSha256);
  return request<ImportResult>(`${API}/import`, { method: "POST", body: form });
}

export function listSnapshots(): Promise<SnapshotInfo[]> {
  return request<{ snapshots: SnapshotInfo[] }>(`${API}/import/snapshots`).then((r) => r.snapshots);
}

export function restoreSnapshot(name: string): Promise<RestoreResult> {
  return request<RestoreResult>(`${API}/import/snapshots/${encodeURIComponent(name)}/restore`, {
    method: "POST",
  });
}

export function getTeams(): Promise<Team[]> {
  return request<Team[]>(`${API}/teams`);
}

export function createTeam(name: string): Promise<Team> {
  return request<Team>(`${API}/teams`, json({ name }));
}

export function renameTeam(id: number, name: string): Promise<Team> {
  return request<Team>(`${API}/teams/${id}`, { ...json({ name }), method: "PATCH" });
}

export function deleteTeam(id: number, force = false): Promise<void> {
  return request<void>(`${API}/teams/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });
}

export function getBoards(): Promise<Board[]> {
  return request<Board[]>(`${API}/boards`);
}

export function addLane(boardId: number, name: string): Promise<Lane> {
  return request<Lane>(`${API}/boards/${boardId}/lanes`, json({ name }));
}

export function renameLane(laneId: number, name: string): Promise<Lane> {
  return request<Lane>(`${API}/lanes/${laneId}`, { ...json({ name }), method: "PATCH" });
}

export function deleteLane(laneId: number): Promise<void> {
  return request<void>(`${API}/lanes/${laneId}`, { method: "DELETE" });
}

export function reorderLanes(boardId: number, laneIds: number[]): Promise<Lane[]> {
  return request<Lane[]>(`${API}/boards/${boardId}/lanes/order`, {
    ...json({ lane_ids: laneIds }),
    method: "PUT",
  });
}

export function getCapacities(): Promise<Capacity[]> {
  return request<Capacity[]>(`${API}/capacities`);
}

export function upsertCapacity(body: {
  user_id: number;
  planning_interval: string;
  iteration: number;
  points: number;
}): Promise<Capacity> {
  return request<Capacity>(`${API}/capacities`, { ...json(body), method: "PUT" });
}

export function getPlanningIntervals(): Promise<PlanningInterval[]> {
  return request<PlanningInterval[]>(`${API}/planning-intervals`);
}

export function createPlanningInterval(name: string): Promise<PlanningInterval> {
  return request<PlanningInterval>(`${API}/planning-intervals`, json({ name }));
}

export function renamePlanningInterval(id: number, name: string): Promise<PlanningInterval> {
  return request<PlanningInterval>(`${API}/planning-intervals/${id}`, { ...json({ name }), method: "PATCH" });
}

export function deletePlanningInterval(id: number, force = false): Promise<void> {
  return request<void>(`${API}/planning-intervals/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });
}

export function login(email: string, password: string): Promise<AuthUser> {
  return request<AuthUser>(`${API}/auth/login`, json({ email, password }), false);
}

export function logout(): Promise<void> {
  return request<void>(`${API}/auth/logout`, { method: "POST" });
}

export function getMe(): Promise<AuthUser> {
  return request<AuthUser>(`${API}/auth/me`, undefined, false);
}

export function changeMyPassword(current_password: string, new_password: string): Promise<void> {
  return request<void>(
    `${API}/auth/me/password`,
    { ...json({ current_password, new_password }), method: "PATCH" },
    false, // a wrong current password is not a session death — the modal shows the error
  );
}

export function listUsers(): Promise<AuthUser[]> {
  return request<AuthUser[]>(`${API}/users`);
}

export function createUser(payload: {
  email: string | null;
  display_name: string;
  password: string | null;
  role: "admin" | "member";
  team_id?: number | null;
}): Promise<AuthUser> {
  return request<AuthUser>(`${API}/users`, json(payload));
}

export function updateUser(
  id: number,
  payload: Partial<{
    display_name: string;
    email: string | null;
    role: "admin" | "member";
    is_active: boolean;
    password: string;
    team_id: number | null;
  }>,
): Promise<AuthUser> {
  return request<AuthUser>(`${API}/users/${id}`, { ...json(payload), method: "PATCH" });
}

export function deleteUser(id: number, force = false): Promise<void> {
  return request<void>(`${API}/users/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });
}

export function getPersonOptions(): Promise<PersonOption[]> {
  return request<PersonOption[]>(`${API}/users/options`);
}

export function getItemEvents(itemId: number): Promise<AuditEvent[]> {
  return request<AuditEvent[]>(`${API}/items/${itemId}/events`);
}

export function getAuditEvents(
  params: { limit?: number; offset?: number; q?: string; entity_type?: string } = {},
): Promise<{ items: AuditEvent[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.q) qs.set("q", params.q);
  if (params.entity_type) qs.set("entity_type", params.entity_type);
  const suffix = qs.toString();
  return request<{ items: AuditEvent[]; total: number }>(`${API}/audit${suffix ? `?${suffix}` : ""}`);
}

export function getComments(itemId: number): Promise<Comment[]> {
  return request<Comment[]>(`${API}/items/${itemId}/comments`);
}

export function createComment(
  itemId: number,
  payload: { body: string; parent_id?: number | null },
): Promise<Comment> {
  return request<Comment>(`${API}/items/${itemId}/comments`, json(payload));
}

export function updateComment(id: number, body: string): Promise<Comment> {
  return request<Comment>(`${API}/comments/${id}`, { ...json({ body }), method: "PATCH" });
}

export function deleteComment(id: number): Promise<void> {
  return request<void>(`${API}/comments/${id}`, { method: "DELETE" });
}
