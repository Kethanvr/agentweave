import { adminGraphql, monthStart } from "./graphql";
import { AppError } from "./http";
import { assertSafeExternalUrl } from "./security";
import type {
  Actor,
  JsonValue,
  OrgRole,
  TriggerType,
  WorkflowDefinition,
  WorkflowStep,
} from "./types";

type RunStatus = "paused" | "completed" | "failed";

type StartWorkflowOptions = {
  workflowId: string;
  triggerType: TriggerType;
  input?: JsonValue;
  actor: Actor | null;
};

type RunRecord = {
  id: string;
  workflow_id: string;
  input: JsonValue;
  status: string;
  workflow: WorkflowDefinition;
};

const GET_WORKFLOW = `
  query GetWorkflow($id: uuid!) {
    workflows_by_pk(id: $id) {
      id org_id name is_active
      organization { calls_allowed }
      steps(order_by: { position: asc }) { id position name type config }
      triggers { id type config secret_hash next_run_at is_active }
    }
  }
`;

export async function getWorkflow(workflowId: string): Promise<WorkflowDefinition> {
  const data = await adminGraphql<{ workflows_by_pk: WorkflowDefinition | null }>(GET_WORKFLOW, { id: workflowId });
  if (!data.workflows_by_pk) throw new AppError("Workflow not found", "NOT_FOUND", 404);
  if (!data.workflows_by_pk.is_active) throw new AppError("Workflow is disabled", "WORKFLOW_DISABLED");
  return data.workflows_by_pk;
}

export async function getMembership(orgId: string, userId: string): Promise<OrgRole | null> {
  const data = await adminGraphql<{ org_members: Array<{ role: OrgRole }> }>(`
    query Membership($orgId: uuid!, $userId: uuid!) {
      org_members(where: { org_id: { _eq: $orgId }, user_id: { _eq: $userId } }, limit: 1) { role }
    }
  `, { orgId, userId });
  return data.org_members[0]?.role ?? null;
}

function assertCanRun(role: OrgRole | null): asserts role is "owner" | "editor" {
  if (role !== "owner" && role !== "editor") {
    throw new AppError("Owner or editor access is required", "FORBIDDEN", 403);
  }
}

async function ensureQuota(workflow: WorkflowDefinition): Promise<void> {
  const periodStart = monthStart();
  await adminGraphql(`
    mutation EnsureUsage($object: organization_usage_insert_input!) {
      insert_organization_usage_one(
        object: $object
        on_conflict: {
          constraint: organization_usage_org_id_period_start_key
          update_columns: [calls_allowed]
        }
      ) { calls_used calls_allowed }
    }
  `, {
    object: {
      org_id: workflow.org_id,
      period_start: periodStart,
      calls_allowed: workflow.organization.calls_allowed,
    },
  });

  const usage = await adminGraphql<{ organization_usage: Array<{ calls_used: number; calls_allowed: number }> }>(`
    query CurrentUsage($orgId: uuid!, $periodStart: date!) {
      organization_usage(
        where: { org_id: { _eq: $orgId }, period_start: { _eq: $periodStart } }
        limit: 1
      ) { calls_used calls_allowed }
    }
  `, { orgId: workflow.org_id, periodStart });
  const current = usage.organization_usage[0];
  if (!current || current.calls_used >= current.calls_allowed) {
    throw new AppError("Organization quota exhausted", "QUOTA_EXHAUSTED", 429);
  }
}

async function createRun(options: StartWorkflowOptions): Promise<string> {
  const data = await adminGraphql<{ insert_workflow_runs_one: { id: string } }>(`
    mutation CreateRun($object: workflow_runs_insert_input!) {
      insert_workflow_runs_one(object: $object) { id }
    }
  `, {
    object: {
      workflow_id: options.workflowId,
      trigger_type: options.triggerType,
      triggered_by: options.actor?.userId ?? null,
      status: "running",
      input: options.input ?? {},
      started_at: new Date().toISOString(),
    },
  });
  return data.insert_workflow_runs_one.id;
}

export async function startWorkflow(options: StartWorkflowOptions): Promise<{ runId: string; status: RunStatus }> {
  const workflow = await getWorkflow(options.workflowId);
  if (options.actor) {
    assertCanRun(await getMembership(workflow.org_id, options.actor.userId));
  }

  await ensureQuota(workflow);
  const runId = await createRun(options);
  const status = await executeRun({
    runId,
    workflow,
    runInput: options.input ?? {},
    startPosition: 0,
    previousOutput: options.input ?? {},
  });
  return { runId, status };
}

async function insertStepRun(
  runId: string,
  step: WorkflowStep,
  status: string,
  input: JsonValue,
): Promise<string> {
  const data = await adminGraphql<{ insert_step_runs_one: { id: string } }>(`
    mutation InsertStepRun($object: step_runs_insert_input!) {
      insert_step_runs_one(
        object: $object
        on_conflict: {
          constraint: step_runs_workflow_run_id_workflow_step_id_key
          update_columns: [status, input, error, started_at, completed_at]
        }
      ) { id }
    }
  `, {
    object: {
      workflow_run_id: runId,
      workflow_step_id: step.id,
      position: step.position,
      step_name: step.name,
      step_type: step.type,
      status,
      input,
      error: null,
      started_at: status === "skipped" ? null : new Date().toISOString(),
      completed_at: status === "skipped" ? new Date().toISOString() : null,
    },
  });
  return data.insert_step_runs_one.id;
}

async function updateStepRun(
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  await adminGraphql(`
    mutation UpdateStepRun($id: uuid!, $values: step_runs_set_input!) {
      update_step_runs_by_pk(pk_columns: { id: $id }, _set: $values) { id }
    }
  `, { id, values });
}

async function updateRun(runId: string, values: Record<string, unknown>): Promise<void> {
  await adminGraphql(`
    mutation UpdateRun($id: uuid!, $values: workflow_runs_set_input!) {
      update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: $values) { id }
    }
  `, { id: runId, values });
}

async function incrementUsage(orgId: string): Promise<void> {
  await adminGraphql(`
    mutation IncrementUsage($orgId: uuid!, $periodStart: date!) {
      update_organization_usage(
        where: { org_id: { _eq: $orgId }, period_start: { _eq: $periodStart } }
        _inc: { calls_used: 1 }
      ) { affected_rows }
    }
  `, { orgId, periodStart: monthStart() });
}

async function executeRun(options: {
  runId: string;
  workflow: WorkflowDefinition;
  runInput: JsonValue;
  startPosition: number;
  previousOutput: JsonValue;
}): Promise<RunStatus> {
  const { runId, workflow, runInput } = options;
  const steps = workflow.steps;
  let index = steps.findIndex((step) => step.position >= options.startPosition);
  let previousOutput = options.previousOutput;

  if (index < 0) index = steps.length;

  while (index < steps.length) {
    const step = steps[index];
    let stepRunId = "";
    try {
      if (step.type === "approval_gate") {
        stepRunId = await insertStepRun(runId, step, "awaiting_approval", previousOutput);
        await updateRun(runId, { status: "paused" });
        return "paused";
      }

      stepRunId = await insertStepRun(runId, step, "running", previousOutput);

      if (step.type === "conditional_branch") {
        const branch = evaluateBranch(step, previousOutput);
        const targetIndex = steps.findIndex((candidate) => candidate.id === branch.targetStepId);
        if (targetIndex <= index) {
          throw new AppError("Conditional target must be a later step", "INVALID_BRANCH");
        }

        const result = { matched: branch.matched, targetStepId: branch.targetStepId };
        await updateStepRun(stepRunId, {
          status: "completed",
          output: result,
          attempt_count: 1,
          completed_at: new Date().toISOString(),
        });

        for (let skippedIndex = index + 1; skippedIndex < targetIndex; skippedIndex += 1) {
          await insertStepRun(runId, steps[skippedIndex], "skipped", previousOutput);
        }
        index = targetIndex;
        continue;
      }

      previousOutput = await executeStep({
        step,
        stepRunId,
        workflow,
        runId,
        runInput,
        previousOutput,
      });
      await updateStepRun(stepRunId, {
        status: "completed",
        output: previousOutput,
        completed_at: new Date().toISOString(),
      });
      index += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Step execution failed";
      if (stepRunId) {
        await updateStepRun(stepRunId, {
          status: "failed",
          error: message,
          completed_at: new Date().toISOString(),
        });
      }
      await updateRun(runId, {
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      });
      return "failed";
    }
  }

  await updateRun(runId, {
    status: "completed",
    output: previousOutput,
    completed_at: new Date().toISOString(),
  });
  await incrementUsage(workflow.org_id);
  return "completed";
}

async function executeStep(options: {
  step: WorkflowStep;
  stepRunId: string;
  workflow: WorkflowDefinition;
  runId: string;
  runInput: JsonValue;
  previousOutput: JsonValue;
}): Promise<JsonValue> {
  const { step, stepRunId, workflow, runId, runInput, previousOutput } = options;
  switch (step.type) {
    case "llm_call":
      return withRetry(stepRunId, () => callGemini(step.config, runInput));
    case "http_request":
      return withRetry(stepRunId, () => callHttp(step.config, runInput, previousOutput));
    case "db_write": {
      const data = resolveTemplates(step.config.data ?? previousOutput, runInput, previousOutput);
      const inserted = await adminGraphql<{ insert_workflow_outputs_one: { id: string; data: JsonValue } }>(`
        mutation SaveOutput($object: workflow_outputs_insert_input!) {
          insert_workflow_outputs_one(object: $object) { id data }
        }
      `, {
        object: {
          org_id: workflow.org_id,
          workflow_id: workflow.id,
          workflow_run_id: runId,
          data,
        },
      });
      await updateStepRun(stepRunId, { attempt_count: 1 });
      return { outputId: inserted.insert_workflow_outputs_one.id, data: inserted.insert_workflow_outputs_one.data };
    }
    case "notify": {
      const recipient = String(step.config.recipient ?? process.env.DEMO_NOTIFICATION_EMAIL ?? "");
      if (!recipient) throw new AppError("Notify step has no recipient", "INVALID_STEP");
      const subject = renderString(String(step.config.subject ?? `AgentWeave: ${workflow.name}`), runInput, previousOutput);
      const body = renderString(
        String(step.config.body ?? "Workflow completed successfully.\nSaved output ID: {{previousOutput.outputId}}"),
        runInput,
        previousOutput,
      );
      const inserted = await adminGraphql<{ insert_notification_outbox_one: { id: string } }>(`
        mutation QueueNotification($object: notification_outbox_insert_input!) {
          insert_notification_outbox_one(object: $object) { id }
        }
      `, {
        object: {
          org_id: workflow.org_id,
          workflow_run_id: runId,
          recipient,
          subject,
          body,
        },
      });
      await updateStepRun(stepRunId, { attempt_count: 1 });
      return { notificationId: inserted.insert_notification_outbox_one.id, status: "queued" };
    }
    default:
      throw new AppError(`Unsupported step type: ${step.type}`, "INVALID_STEP");
  }
}

async function withRetry<T extends JsonValue>(stepRunId: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await updateStepRun(stepRunId, { attempt_count: attempt });
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

async function callGemini(config: Record<string, JsonValue>, input: JsonValue): Promise<JsonValue> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AppError("GEMINI_API_KEY is not configured", "CONFIGURATION");
  const model = String(config.model ?? "gemini-3.6-flash");
  const prompt = renderString(String(config.prompt ?? "Classify this input as JSON: {{input}}"), input, input);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              priority: { type: "STRING", enum: ["URGENT", "NORMAL"] },
              reason: { type: "STRING" },
            },
            required: ["priority", "reason"],
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new AppError(`Gemini returned ${response.status}`, "LLM_FAILED");
  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new AppError("Gemini returned no content", "LLM_FAILED");
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return { text };
  }
}

async function callHttp(
  config: Record<string, JsonValue>,
  input: JsonValue,
  previousOutput: JsonValue,
): Promise<JsonValue> {
  const url = assertSafeExternalUrl(renderString(String(config.url ?? ""), input, previousOutput));
  const method = String(config.method ?? "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH"].includes(method)) {
    throw new AppError("Unsupported HTTP method", "INVALID_STEP");
  }
  const body = method === "GET" ? undefined : JSON.stringify(resolveTemplates(config.body ?? previousOutput, input, previousOutput));
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new AppError(`HTTP request returned ${response.status}`, "HTTP_FAILED");
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 262_144) throw new AppError("HTTP response is too large", "HTTP_FAILED");
  const text = await response.text();
  if (text.length > 262_144) throw new AppError("HTTP response is too large", "HTTP_FAILED");
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return { status: response.status, text };
  }
}

function evaluateBranch(step: WorkflowStep, previousOutput: JsonValue): { matched: boolean; targetStepId: string } {
  const field = String(step.config.field ?? "");
  const operator = String(step.config.operator ?? "equals");
  if (operator !== "equals") throw new AppError("Only the equals branch operator is supported", "INVALID_BRANCH");
  const actual = readPath(previousOutput, field);
  const matched = String(actual).toUpperCase() === String(step.config.value ?? "").toUpperCase();
  const targetStepId = String(matched ? step.config.true_step_id : step.config.false_step_id);
  if (!targetStepId) throw new AppError("Conditional branch target is missing", "INVALID_BRANCH");
  return { matched, targetStepId };
}

function readPath(value: JsonValue, path: string): JsonValue | undefined {
  if (!path) return value;
  return path.split(".").reduce<JsonValue | undefined>((current, key) => {
    if (current && typeof current === "object" && !Array.isArray(current)) return current[key];
    return undefined;
  }, value);
}

function renderString(template: string, input: JsonValue, previousOutput: JsonValue): string {
  return template.replace(/\{\{\s*(input|previousOutput)(?:\.([\w.]+))?\s*\}\}/g, (_, source: string, path?: string) => {
    const value = readPath(source === "input" ? input : previousOutput, path ?? "");
    return typeof value === "string" ? value : JSON.stringify(value ?? null);
  });
}

function resolveTemplates(value: JsonValue, input: JsonValue, previousOutput: JsonValue): JsonValue {
  if (typeof value === "string") return renderString(value, input, previousOutput);
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, input, previousOutput));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTemplates(item, input, previousOutput)]));
  }
  return value;
}

export async function resumeWorkflow(options: {
  runId: string;
  actor: Actor;
  approvedStepPosition: number;
  previousOutput: JsonValue;
}): Promise<RunStatus> {
  const data = await adminGraphql<{ workflow_runs_by_pk: RunRecord | null }>(`
    query RunForResume($id: uuid!) {
      workflow_runs_by_pk(id: $id) {
        id workflow_id input status
        workflow {
          id org_id name is_active
          organization { calls_allowed }
          steps(order_by: { position: asc }) { id position name type config }
          triggers { id type config secret_hash next_run_at is_active }
        }
      }
    }
  `, { id: options.runId });
  const run = data.workflow_runs_by_pk;
  if (!run) throw new AppError("Workflow run not found", "NOT_FOUND", 404);
  assertCanRun(await getMembership(run.workflow.org_id, options.actor.userId));
  await updateRun(run.id, { status: "running", error: null });
  return executeRun({
    runId: run.id,
    workflow: run.workflow,
    runInput: run.input,
    startPosition: options.approvedStepPosition + 1,
    previousOutput: options.previousOutput,
  });
}
