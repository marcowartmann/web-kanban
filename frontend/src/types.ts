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
  iteration: string | null;
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
}

export interface BoardCard extends Item {
  children_count: number;
  children_points: number;
}

export interface BoardColumn {
  status: string;
  cards: BoardCard[];
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
  iteration?: string | null;
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
