import { adminGraphql } from "./_shared/graphql";
import {
  AppError,
  assertHasuraWebhook,
  sendError,
  type FunctionRequest,
  type FunctionResponse,
} from "./_shared/http";
import { getWorkflow, startWorkflow } from "./_shared/runner";
import type { JsonValue } from "./_shared/types";

type InboxEvent = {
  id: string;
  workflow_id: string;
  payload: JsonValue;
};

export default async function handler(req: FunctionRequest, res: FunctionResponse) {
  try {
    assertHasuraWebhook(req);
    const body = req.body as { event?: { data?: { new?: InboxEvent } } } | undefined;
    const event = body?.event?.data?.new;
    if (!event) throw new AppError("Database event payload is missing", "INVALID_EVENT");
    const workflow = await getWorkflow(event.workflow_id);
    if (!workflow.triggers.some((trigger) => trigger.type === "database_event" && trigger.is_active)) {
      throw new AppError("Workflow has no active database-event trigger", "TRIGGER_DISABLED");
    }

    const run = await startWorkflow({
      workflowId: event.workflow_id,
      triggerType: "database_event",
      input: event.payload,
      actor: null,
    });
    await adminGraphql(`
      mutation MarkInboxProcessed($id: uuid!, $processedAt: timestamptz!) {
        update_workflow_inbox_events_by_pk(
          pk_columns: { id: $id }
          _set: { processed_at: $processedAt }
        ) { id }
      }
    `, { id: event.id, processedAt: new Date().toISOString() });
    res.status(200).json(run);
  } catch (error) {
    sendError(res, error);
  }
}

