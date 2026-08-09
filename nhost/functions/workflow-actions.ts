import { adminGraphql } from "./_shared/graphql";
import {
  AppError,
  assertHasuraWebhook,
  sendError,
  type FunctionRequest,
  type FunctionResponse,
} from "./_shared/http";
import { getMembership, getWorkflow, resumeWorkflow, startWorkflow } from "./_shared/runner";
import { hashSecret, secretsMatch } from "./_shared/security";
import type { JsonValue, OrgRole, StepType, TriggerType } from "./_shared/types";

type ActionBody = {
  action?: { name?: string };
  input?: Record<string, unknown>;
  session_variables?: Record<string, string>;
};

type StepInput = {
  id: string;
  position: number;
  name: string;
  type: StepType;
  config: Record<string, JsonValue>;
};

type TriggerInput = {
  id: string;
  type: TriggerType;
  config: Record<string, JsonValue>;
  secret?: string | null;
  nextRunAt?: string | null;
  isActive: boolean;
};

type WorkflowInput = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  isActive: boolean;
  steps: StepInput[];
  triggers: TriggerInput[];
};

function sessionUser(body: ActionBody): string {
  const userId = body.session_variables?.["x-hasura-user-id"];
  if (!userId) throw new AppError("Authentication is required", "UNAUTHENTICATED", 401);
  return userId;
}

function assertCanEdit(role: OrgRole | null): asserts role is "owner" | "editor" {
  if (role !== "owner" && role !== "editor") {
    throw new AppError("Owner or editor access is required", "FORBIDDEN", 403);
  }
}

function validateWorkflowInput(input: WorkflowInput, role: OrgRole): void {
  if (!input.name?.trim() || input.name.trim().length > 120) {
    throw new AppError("Workflow name must be between 1 and 120 characters", "INVALID_INPUT");
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new AppError("A workflow needs at least one step", "INVALID_INPUT");
  }

  const ids = new Set<string>();
  const positions = new Set<number>();
  for (const step of input.steps) {
    if (ids.has(step.id) || positions.has(step.position)) {
      throw new AppError("Step IDs and positions must be unique", "INVALID_INPUT");
    }
    ids.add(step.id);
    positions.add(step.position);
    if (!Number.isInteger(step.position) || step.position < 0) {
      throw new AppError("Step positions must be positive integers", "INVALID_INPUT");
    }
    if (role !== "owner" && ["db_write", "notify"].includes(step.type)) {
      throw new AppError(`Only owners can configure ${step.type} steps`, "FORBIDDEN", 403);
    }
  }

  const byId = new Map(input.steps.map((step) => [step.id, step]));
  for (const step of input.steps.filter((item) => item.type === "conditional_branch")) {
    const targets = [String(step.config.true_step_id ?? ""), String(step.config.false_step_id ?? "")];
    for (const targetId of targets) {
      const target = byId.get(targetId);
      if (!target || target.position <= step.position) {
        throw new AppError("Conditional branches must target later steps in this workflow", "INVALID_BRANCH");
      }
    }
  }

  const triggerTypes = new Set<string>();
  for (const trigger of input.triggers) {
    if (triggerTypes.has(trigger.type)) throw new AppError("Trigger types must be unique", "INVALID_INPUT");
    triggerTypes.add(trigger.type);
    if (role !== "owner" && trigger.type === "webhook") {
      throw new AppError("Only owners can configure webhook triggers", "FORBIDDEN", 403);
    }
  }
}

async function saveWorkflow(body: ActionBody): Promise<{ workflowId: string }> {
  const userId = sessionUser(body);
  const input = body.input?.input as WorkflowInput | undefined;
  if (!input) throw new AppError("Workflow input is required", "INVALID_INPUT");

  const role = await getMembership(input.organizationId, userId);
  assertCanEdit(role);
  validateWorkflowInput(input, role);

  const existing = await adminGraphql<{
    workflows_by_pk: { org_id: string; triggers: Array<{ id: string; secret_hash: string | null }> } | null;
  }>(`
    query ExistingWorkflow($id: uuid!) {
      workflows_by_pk(id: $id) { org_id triggers { id secret_hash } }
    }
  `, { id: input.id });
  if (existing.workflows_by_pk && existing.workflows_by_pk.org_id !== input.organizationId) {
    throw new AppError("Workflow belongs to another organization", "FORBIDDEN", 403);
  }
  const existingSecrets = new Map(existing.workflows_by_pk?.triggers.map((trigger) => [trigger.id, trigger.secret_hash]) ?? []);

  const triggerObjects = input.triggers.map((trigger) => {
    let secretHash: string | null = null;
    if (trigger.type === "webhook") {
      secretHash = trigger.secret?.trim()
        ? hashSecret(trigger.secret.trim())
        : existingSecrets.get(trigger.id) ?? null;
      if (!secretHash) throw new AppError("A webhook secret is required", "INVALID_INPUT");
    }
    return {
      id: trigger.id,
      workflow_id: input.id,
      type: trigger.type,
      config: trigger.config ?? {},
      secret_hash: secretHash,
      next_run_at: trigger.type === "scheduled" ? trigger.nextRunAt ?? new Date().toISOString() : null,
      is_active: trigger.isActive,
    };
  });

  await adminGraphql(`
    mutation SaveWorkflow(
      $workflow: workflows_insert_input!
      $workflowId: uuid!
      $steps: [workflow_steps_insert_input!]!
      $triggers: [workflow_triggers_insert_input!]!
    ) {
      insert_workflows_one(
        object: $workflow
        on_conflict: { constraint: workflows_pkey, update_columns: [name, description, is_active, updated_at] }
      ) { id }
      delete_workflow_steps(where: { workflow_id: { _eq: $workflowId } }) { affected_rows }
      delete_workflow_triggers(where: { workflow_id: { _eq: $workflowId } }) { affected_rows }
      insert_workflow_steps(objects: $steps) { affected_rows }
      insert_workflow_triggers(objects: $triggers) { affected_rows }
    }
  `, {
    workflowId: input.id,
    workflow: {
      id: input.id,
      org_id: input.organizationId,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      is_active: input.isActive,
      created_by: userId,
      updated_at: new Date().toISOString(),
    },
    steps: input.steps.map((step) => ({ ...step, workflow_id: input.id })),
    triggers: triggerObjects,
  });

  return { workflowId: input.id };
}

async function triggerManual(body: ActionBody) {
  const userId = sessionUser(body);
  return startWorkflow({
    workflowId: String(body.input?.workflowId ?? ""),
    triggerType: "manual",
    input: (body.input?.input ?? {}) as JsonValue,
    actor: { userId },
  });
}

async function triggerWebhook(body: ActionBody) {
  const workflowId = String(body.input?.workflowId ?? "");
  const secret = String(body.input?.secret ?? "");
  const workflow = await getWorkflow(workflowId);
  const trigger = workflow.triggers.find((item) => item.type === "webhook" && item.is_active);
  if (!trigger || !secretsMatch(secret, trigger.secret_hash)) {
    throw new AppError("Invalid workflow webhook", "FORBIDDEN", 403);
  }
  return startWorkflow({
    workflowId,
    triggerType: "webhook",
    input: (body.input?.input ?? {}) as JsonValue,
    actor: null,
  });
}

async function approve(body: ActionBody) {
  const userId = sessionUser(body);
  const stepRunId = String(body.input?.stepRunId ?? "");
  const data = await adminGraphql<{
    step_runs_by_pk: {
      id: string;
      workflow_run_id: string;
      position: number;
      status: string;
      input: JsonValue;
      run: { status: string; workflow: { org_id: string } };
    } | null;
  }>(`
    query ApprovalStep($id: uuid!) {
      step_runs_by_pk(id: $id) {
        id workflow_run_id position status input
        run { status workflow { org_id } }
      }
    }
  `, { id: stepRunId });
  const stepRun = data.step_runs_by_pk;
  if (!stepRun) throw new AppError("Approval step not found", "NOT_FOUND", 404);
  assertCanEdit(await getMembership(stepRun.run.workflow.org_id, userId));
  if (stepRun.status !== "awaiting_approval" || stepRun.run.status !== "paused") {
    throw new AppError("This approval gate is no longer awaiting approval", "CONFLICT", 409);
  }

  const updated = await adminGraphql<{ update_step_runs: { affected_rows: number } }>(`
    mutation ApproveStep($id: uuid!, $userId: uuid!, $approvedAt: timestamptz!) {
      update_step_runs(
        where: { id: { _eq: $id }, status: { _eq: "awaiting_approval" } }
        _set: {
          status: "completed"
          approved_by: $userId
          approved_at: $approvedAt
          completed_at: $approvedAt
          output: { approved: true }
        }
      ) { affected_rows }
    }
  `, { id: stepRunId, userId, approvedAt: new Date().toISOString() });
  if (updated.update_step_runs.affected_rows !== 1) {
    throw new AppError("This approval gate was already handled", "CONFLICT", 409);
  }

  const status = await resumeWorkflow({
    runId: stepRun.workflow_run_id,
    actor: { userId },
    approvedStepPosition: stepRun.position,
    previousOutput: stepRun.input,
  });
  return { runId: stepRun.workflow_run_id, stepRunId, status };
}

export default async function handler(req: FunctionRequest, res: FunctionResponse) {
  try {
    assertHasuraWebhook(req);
    const body = (req.body ?? {}) as ActionBody;
    let result: unknown;
    switch (body.action?.name) {
      case "saveWorkflow":
        result = await saveWorkflow(body);
        break;
      case "triggerWorkflowRun":
        result = await triggerManual(body);
        break;
      case "triggerWorkflowWebhook":
        result = await triggerWebhook(body);
        break;
      case "approveStep":
        result = await approve(body);
        break;
      default:
        throw new AppError("Unknown Hasura Action", "INVALID_ACTION", 404);
    }
    res.status(200).json(result);
  } catch (error) {
    sendError(res, error);
  }
}

