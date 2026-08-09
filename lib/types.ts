export type OrgRole = "owner" | "editor" | "viewer";
export type StepType =
  | "llm_call"
  | "http_request"
  | "conditional_branch"
  | "approval_gate"
  | "db_write"
  | "notify";
export type TriggerType = "manual" | "webhook" | "scheduled" | "database_event";

export interface EditorStep {
  id: string;
  position: number;
  name: string;
  type: StepType;
  config: Record<string, unknown>;
}

export interface EditorTrigger {
  id: string;
  type: TriggerType;
  config: Record<string, unknown>;
  secret?: string;
  nextRunAt?: string | null;
  isActive: boolean;
}

export interface RunStep {
  id: string;
  position: number;
  step_name: string;
  step_type: StepType;
  status: "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "skipped";
  attempt_count: number;
  error: string | null;
  output: unknown;
  approved_at: string | null;
}

