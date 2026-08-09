export type OrgRole = "owner" | "editor" | "viewer";
export type TriggerType = "manual" | "webhook" | "scheduled" | "database_event";
export type StepType =
  | "llm_call"
  | "http_request"
  | "conditional_branch"
  | "approval_gate"
  | "db_write"
  | "notify";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Actor {
  userId: string;
}

export interface WorkflowStep {
  id: string;
  position: number;
  name: string;
  type: StepType;
  config: Record<string, JsonValue>;
}

export interface WorkflowTrigger {
  id: string;
  type: TriggerType;
  config: Record<string, JsonValue>;
  secret_hash: string | null;
  next_run_at: string | null;
  is_active: boolean;
}

export interface WorkflowDefinition {
  id: string;
  org_id: string;
  name: string;
  is_active: boolean;
  organization: { calls_allowed: number };
  steps: WorkflowStep[];
  triggers: WorkflowTrigger[];
}

