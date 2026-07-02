export type ItemKind = "feature" | "story" | "risk";

export interface Item {
  id: number;
  kind: ItemKind;
  type: string | null;
  parent_id: number | null;
  position: number;
  title: string;
  description: string | null;
  kategorie: string | null;
  art: string | null;
  sdi_prio: string | null;
  status: string | null;
  tshirt_size: string | null;
  wsjf_score: number | null;
  story_points: number | null;
  planning_interval: string | null;
  iteration: number | null;
  leading_team: string | null;
  supporting_team: string | null;
  externer_partner: string | null;
  assignee: string | null;
  akzeptanzkriterien: string | null;
  dependencies: string | null;
  bo_stakeholder: string | null;
  business_value: number | null;
  time_criticality: number | null;
  risk_reduction: number | null;
  cost_of_delay: number | null;
  job_size: number | null;
  definition_of_done: string | null;
  children?: Item[];
  links?: LinkedItem[];
}

export interface BoardCard extends Item {
  children_count: number;
  children_points: number;
  blocked_by_count?: number;
  blocks_count?: number;
  related_count?: number;
}

export interface BoardColumn {
  status: string;
  cards: BoardCard[];
}

export interface ItemRef {
  id: number;
  title: string;
  kind: ItemKind;
  status: string | null;
  planning_interval: string | null;
}

export interface LinkedItem {
  link_id: number;
  relation: string;
  direction: "outgoing" | "incoming";
  label: string;
  item: ItemRef;
}

export interface RelationOption {
  relation: string;
  direction: "outgoing" | "incoming" | "both";
  label: string;
}

export interface LinkRow {
  id: number;
  source_id: number;
  target_id: number;
  relation: string;
}

export interface ImportResult {
  features: number;
  stories: number;
  risks: number;
  warnings: string[];
}

export interface ItemCreate {
  kind: ItemKind;
  title: string;
  parent_id?: number | null;
  status?: string | null;
  [key: string]: unknown;
}

// Mirrors backend ItemUpdate (extra="forbid"): only these fields may be PATCHed.
// `type`, `art`, `cost_of_delay`, `kind`, `parent_id`, and timestamps are NOT editable.
export interface ItemUpdate {
  title?: string | null;
  description?: string | null;
  status?: string | null;
  position?: number | null;
  tshirt_size?: string | null;
  planning_interval?: string | null;
  iteration?: number | null;
  leading_team?: string | null;
  supporting_team?: string | null;
  externer_partner?: string | null;
  assignee?: string | null;
  kategorie?: string | null;
  sdi_prio?: string | null;
  akzeptanzkriterien?: string | null;
  dependencies?: string | null;
  bo_stakeholder?: string | null;
  definition_of_done?: string | null;
  story_points?: number | null;
  business_value?: number | null;
  time_criticality?: number | null;
  risk_reduction?: number | null;
  job_size?: number | null;
  wsjf_score?: number | null;
}

export interface Team {
  id: number;
  name: string;
}

export interface TeamMember {
  id: number;
  name: string;
  team_id: number | null;
  team_name: string | null;
}

export interface Capacity {
  id: number;
  member_id: number;
  planning_interval: string;
  iteration: number;
  points: number;
}

export interface Lane {
  id: number;
  name: string;
  position: number;
}

export interface Board {
  id: number;
  name: string;
  kinds: ItemKind[];
  position: number;
  lanes: Lane[];
}

export interface PlanningInterval {
  id: number;
  name: string;
  position: number;
}

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role: "admin" | "member";
  is_active: boolean;
  team_id?: number | null;
  team_name?: string | null;
}
