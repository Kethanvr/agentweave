import { adminGraphql } from "./_shared/graphql";
import {
  AppError,
  assertHasuraWebhook,
  sendError,
  type FunctionRequest,
  type FunctionResponse,
} from "./_shared/http";
import { startWorkflow } from "./_shared/runner";

type DueTrigger = {
  id: string;
  workflow_id: string;
  config: { interval_minutes?: number; input?: Record<string, unknown> };
};

export default async function handler(req: FunctionRequest, res: FunctionResponse) {
  try {
    assertHasuraWebhook(req);
    const data = await adminGraphql<{ workflow_triggers: DueTrigger[] }>(`
      query DueScheduledTriggers($now: timestamptz!) {
        workflow_triggers(
          where: {
            type: { _eq: "scheduled" }
            is_active: { _eq: true }
            next_run_at: { _lte: $now }
          }
          order_by: { next_run_at: asc }
          limit: 5
        ) { id workflow_id config }
      }
    `, { now: new Date().toISOString() });

    const results: Array<{ workflowId: string; runId?: string; status: string }> = [];
    for (const trigger of data.workflow_triggers) {
      const interval = Math.max(1, Number(trigger.config.interval_minutes ?? 60));
      const nextRunAt = new Date(Date.now() + interval * 60_000).toISOString();
      await adminGraphql(`
        mutation AdvanceSchedule($id: uuid!, $nextRunAt: timestamptz!) {
          update_workflow_triggers_by_pk(pk_columns: { id: $id }, _set: { next_run_at: $nextRunAt }) { id }
        }
      `, { id: trigger.id, nextRunAt });
      try {
        const run = await startWorkflow({
          workflowId: trigger.workflow_id,
          triggerType: "scheduled",
          input: (trigger.config.input ?? {}) as never,
          actor: null,
        });
        results.push({ workflowId: trigger.workflow_id, runId: run.runId, status: run.status });
      } catch (error) {
        results.push({
          workflowId: trigger.workflow_id,
          status: error instanceof Error ? error.message : "failed",
        });
      }
    }

    res.status(200).json({ processed: results.length, results });
  } catch (error) {
    sendError(res, error instanceof Error ? error : new AppError("Scheduled trigger failed"));
  }
}

