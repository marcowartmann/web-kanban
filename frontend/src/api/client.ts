import type {
  AuthUser,
  Board,
  Capacity,
  ImportResult,
  Item,
  ItemCreate,
  ItemUpdate,
  Lane,
  LinkRow,
  PlanningInterval,
  RelationOption,
  Team,
  TeamMember,
} from "../types";

let onUnauthorized: (() => void) | null = null;

/** Called on any 401 except login/getMe probes — lets the app flip back to the login screen. */
export function setUnauthorizedHandler(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

async function request<T>(url: string, init?: RequestInit, notify401 = true): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    if (resp.status === 401 && notify401) onUnauthorized?.();
    const detail = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText}: ${detail}`);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function listItems(params: Record<string, string> = {}): Promise<Item[]> {
  const qs = new URLSearchParams(params).toString();
  return request<Item[]>(`/api/items${qs ? `?${qs}` : ""}`);
}

export function getItem(id: number): Promise<Item> {
  return request<Item>(`/api/items/${id}`);
}

export function createItem(body: ItemCreate): Promise<Item> {
  return request<Item>("/api/items", json(body));
}

export function updateItem(id: number, patch: ItemUpdate): Promise<Item> {
  return request<Item>(`/api/items/${id}`, { ...json(patch), method: "PATCH" });
}

export function deleteItem(id: number): Promise<void> {
  return request<void>(`/api/items/${id}`, { method: "DELETE" });
}

export function getLinkRelations(): Promise<RelationOption[]> {
  return request<RelationOption[]>("/api/link-relations");
}

export function listLinks(): Promise<LinkRow[]> {
  return request<LinkRow[]>("/api/links");
}

export function createLink(body: {
  source_id: number;
  target_id: number;
  relation: string;
}): Promise<LinkRow> {
  return request<LinkRow>("/api/links", json(body));
}

export function deleteLink(linkId: number): Promise<void> {
  return request<void>(`/api/links/${linkId}`, { method: "DELETE" });
}

export function importCsv(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  return request<ImportResult>("/api/import", { method: "POST", body: form });
}

export function getTeams(): Promise<Team[]> {
  return request<Team[]>("/api/teams");
}

export function createTeam(name: string): Promise<Team> {
  return request<Team>("/api/teams", json({ name }));
}

export function deleteTeam(id: number): Promise<void> {
  return request<void>(`/api/teams/${id}`, { method: "DELETE" });
}

export function getTeamMembers(): Promise<TeamMember[]> {
  return request<TeamMember[]>("/api/team-members");
}

export function createTeamMember(body: {
  name: string;
  team_id?: number | null;
}): Promise<TeamMember> {
  return request<TeamMember>("/api/team-members", json(body));
}

export function deleteTeamMember(id: number): Promise<void> {
  return request<void>(`/api/team-members/${id}`, { method: "DELETE" });
}

export function getBoards(): Promise<Board[]> {
  return request<Board[]>("/api/boards");
}

export function addLane(boardId: number, name: string): Promise<Lane> {
  return request<Lane>(`/api/boards/${boardId}/lanes`, json({ name }));
}

export function renameLane(laneId: number, name: string): Promise<Lane> {
  return request<Lane>(`/api/lanes/${laneId}`, { ...json({ name }), method: "PATCH" });
}

export function deleteLane(laneId: number): Promise<void> {
  return request<void>(`/api/lanes/${laneId}`, { method: "DELETE" });
}

export function reorderLanes(boardId: number, laneIds: number[]): Promise<Lane[]> {
  return request<Lane[]>(`/api/boards/${boardId}/lanes/order`, {
    ...json({ lane_ids: laneIds }),
    method: "PUT",
  });
}

export function getCapacities(): Promise<Capacity[]> {
  return request<Capacity[]>("/api/capacities");
}

export function upsertCapacity(body: {
  member_id: number;
  planning_interval: string;
  iteration: number;
  points: number;
}): Promise<Capacity> {
  return request<Capacity>("/api/capacities", { ...json(body), method: "PUT" });
}

export function getPlanningIntervals(): Promise<PlanningInterval[]> {
  return request<PlanningInterval[]>("/api/planning-intervals");
}

export function createPlanningInterval(name: string): Promise<PlanningInterval> {
  return request<PlanningInterval>("/api/planning-intervals", json({ name }));
}

export function deletePlanningInterval(id: number): Promise<void> {
  return request<void>(`/api/planning-intervals/${id}`, { method: "DELETE" });
}

export function login(email: string, password: string): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/login", json({ email, password }), false);
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function getMe(): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/me", undefined, false);
}

export function changeMyPassword(current_password: string, new_password: string): Promise<void> {
  return request<void>("/api/auth/me/password", {
    ...json({ current_password, new_password }),
    method: "PATCH",
  });
}

export function listUsers(): Promise<AuthUser[]> {
  return request<AuthUser[]>("/api/users");
}

export function createUser(payload: {
  email: string;
  display_name: string;
  password: string;
  role: "admin" | "member";
}): Promise<AuthUser> {
  return request<AuthUser>("/api/users", json(payload));
}

export function updateUser(
  id: number,
  payload: Partial<{ display_name: string; role: "admin" | "member"; is_active: boolean; password: string }>,
): Promise<AuthUser> {
  return request<AuthUser>(`/api/users/${id}`, { ...json(payload), method: "PATCH" });
}
