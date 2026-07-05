import type {
  AuditEvent,
  AuthUser,
  BackupConfig,
  BackupRun,
  Board,
  Capacity,
  Comment,
  Container,
  Department,
  ImportPreview,
  ImportResult,
  Item,
  ItemCreate,
  ItemUpdate,
  Lane,
  LdapConfig,
  LinkRow,
  ObjectiveState,
  PersonOption,
  PIObjective,
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

export function reorderFeatureRanking(featureId: number, afterId: number | null): Promise<void> {
  return request<void>(`${API}/features/ranking/reorder`, json({ feature_id: featureId, after_id: afterId }));
}

export function getDepartments(): Promise<Department[]> {
  return request<Department[]>(`${API}/departments`);
}

export function createDepartment(name: string, teamId: number): Promise<Department> {
  return request<Department>(`${API}/departments`, json({ name, team_id: teamId }));
}

export function renameDepartment(id: number, name: string): Promise<Department> {
  return request<Department>(`${API}/departments/${id}`, { ...json({ name }), method: "PATCH" });
}

export function deleteDepartment(id: number): Promise<void> {
  return request<void>(`${API}/departments/${id}`, { method: "DELETE" });
}

export function setDepartmentMembers(id: number, userIds: number[]): Promise<Department> {
  return request<Department>(`${API}/departments/${id}/members`, { ...json({ user_ids: userIds }), method: "PUT" });
}

export function setUserDepartments(userId: number, departmentIds: number[]): Promise<AuthUser> {
  return request<AuthUser>(`${API}/users/${userId}/departments`, { ...json({ department_ids: departmentIds }), method: "PUT" });
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

export function createSnapshot(): Promise<SnapshotInfo> {
  return request<SnapshotInfo>(`${API}/import/snapshots`, { method: "POST" });
}

export function uploadSnapshot(file: File): Promise<SnapshotInfo> {
  const form = new FormData();
  form.append("file", file);
  return request<SnapshotInfo>(`${API}/import/snapshots/upload`, { method: "POST", body: form });
}

export function deleteSnapshot(name: string, force = false): Promise<void> {
  return request<void>(
    `${API}/import/snapshots/${encodeURIComponent(name)}${force ? "?force=true" : ""}`,
    { method: "DELETE" },
  );
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

export function getContainers(): Promise<Container[]> {
  return request<Container[]>(`${API}/containers`);
}

export function createContainer(body: {
  name: string;
  planning_interval: string;
  team_id: number;
}): Promise<Container> {
  return request<Container>(`${API}/containers`, json(body));
}

export function renameContainer(id: number, name: string): Promise<Container> {
  return request<Container>(`${API}/containers/${id}`, { ...json({ name }), method: "PATCH" });
}

export function deleteContainer(id: number, force = false): Promise<void> {
  return request<void>(`${API}/containers/${id}${force ? "?force=true" : ""}`, {
    method: "DELETE",
  });
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

export function login(
  username: string,
  password: string,
  method: "local" | "ldap",
): Promise<AuthUser> {
  return request<AuthUser>(`${API}/auth/login`, json({ username, password, method }), false);
}

export function getAuthConfig(): Promise<{ ldap_enabled: boolean }> {
  return request<{ ldap_enabled: boolean }>(`${API}/auth/config`, {}, false);
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
  username: string | null;
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
    username: string | null;
    role: "admin" | "member";
    is_active: boolean;
    password: string;
    team_id: number | null;
  }>,
): Promise<AuthUser> {
  return request<AuthUser>(`${API}/users/${id}`, { ...json(payload), method: "PATCH" });
}

export function deleteUser(id: number): Promise<void> {
  return request<void>(`${API}/users/${id}`, { method: "DELETE" });
}

export function convertUserProvider(
  id: number,
  provider: "local" | "ldap",
  password?: string,
): Promise<AuthUser> {
  return request<AuthUser>(`${API}/users/${id}/convert-provider`, json({ provider, password }));
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

// --- PI Objectives ---
export function getPIObjectives(params: { planning_interval?: string; team?: string }): Promise<PIObjective[]> {
  const q = new URLSearchParams();
  if (params.planning_interval) q.set("planning_interval", params.planning_interval);
  if (params.team) q.set("team", params.team);
  return request<PIObjective[]>(`${API}/pi-objectives?${q.toString()}`);
}

export function createPIObjective(body: {
  team_id: number;
  planning_interval: string;
  title: string;
  description?: string | null;
  state?: ObjectiveState;
  is_key_delivery?: boolean;
  feature_ids?: number[];
}): Promise<PIObjective> {
  return request<PIObjective>(`${API}/pi-objectives`, json(body));
}

export function updatePIObjective(
  id: number,
  body: Partial<{ title: string; description: string | null; state: ObjectiveState; is_key_delivery: boolean; position: number }>,
): Promise<PIObjective> {
  return request<PIObjective>(`${API}/pi-objectives/${id}`, { ...json(body), method: "PATCH" });
}

export function setObjectiveFeatures(id: number, feature_ids: number[]): Promise<PIObjective> {
  return request<PIObjective>(`${API}/pi-objectives/${id}/features`, { ...json({ feature_ids }), method: "PUT" });
}

export function deletePIObjective(id: number): Promise<void> {
  return request<void>(`${API}/pi-objectives/${id}`, { method: "DELETE" });
}

export function getObjectiveLinkedFeatures(): Promise<number[]> {
  return request<number[]>(`${API}/pi-objectives/linked-features`);
}

// --- Backup (SFTP) ---
export function getBackupConfig(): Promise<BackupConfig> {
  return request<BackupConfig>(`${API}/backup/config`);
}
export function saveBackupConfig(
  body: Omit<BackupConfig, "has_password"> & { password?: string; clear_password?: boolean },
): Promise<BackupConfig> {
  return request<BackupConfig>(`${API}/backup/config`, { ...json(body), method: "PUT" });
}
export function testBackup(
  body: { sftp_host?: string; sftp_port?: number; sftp_username?: string; password?: string; remote_dir?: string },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`${API}/backup/test`, json(body));
}
export function runBackup(): Promise<BackupRun> {
  return request<BackupRun>(`${API}/backup/run`, { method: "POST" });
}
export function getBackupRuns(): Promise<BackupRun[]> {
  return request<BackupRun[]>(`${API}/backup/runs`);
}

// --- LDAP authentication config ---
export function getLdapConfig(): Promise<LdapConfig> {
  return request<LdapConfig>(`${API}/ldap/config`);
}
export function saveLdapConfig(
  body: Omit<LdapConfig, "has_password"> & { password?: string; clear_password?: boolean },
): Promise<LdapConfig> {
  return request<LdapConfig>(`${API}/ldap/config`, { ...json(body), method: "PUT" });
}
export function testLdap(
  body: Partial<Omit<LdapConfig, "has_password">> & {
    password?: string;
    test_username?: string;
    test_password?: string;
  },
): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>(`${API}/ldap/test`, json(body));
}
