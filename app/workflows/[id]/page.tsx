import { randomUUID } from "node:crypto";
import { WorkflowEditor, type InitialWorkflowDraft } from "@/components/workflow-editor";

export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { id } = await params;
  const { org } = await searchParams;
  const isNew = id === "new";
  const workflowId = isNew ? randomUUID() : id;
  let initialDraft: InitialWorkflowDraft | undefined;

  if (isNew) {
    const stepIds = Array.from({ length: 6 }, () => randomUUID());
    initialDraft = {
      id: workflowId,
      name: "Customer Escalation Workflow",
      description: "Classify customer incidents, enrich urgent cases, require approval, and notify the response team.",
      isActive: true,
      steps: [
        {
          id: stepIds[0], position: 0, name: "Classify escalation", type: "llm_call",
          config: {
            model: "gemini-3.6-flash",
            prompt: "Return JSON with keys priority and reason. Use priority URGENT when this describes a production outage or severe service disruption; otherwise NORMAL. Customer message: {{input.message}}",
          },
        },
        {
          id: stepIds[1], position: 1, name: "Route urgent incidents", type: "conditional_branch",
          config: { field: "priority", operator: "equals", value: "URGENT", true_step_id: stepIds[2], false_step_id: stepIds[3] },
        },
        {
          id: stepIds[2], position: 2, name: "Enrich incident", type: "http_request",
          config: { method: "POST", url: "https://postman-echo.com/post", body: "{{previousOutput}}" },
        },
        {
          id: stepIds[3], position: 3, name: "Human approval", type: "approval_gate",
          config: { instructions: "Confirm this escalation before it is persisted and announced." },
        },
        {
          id: stepIds[4], position: 4, name: "Save escalation", type: "db_write",
          config: { data: { escalation: "{{previousOutput}}" } },
        },
        {
          id: stepIds[5], position: 5, name: "Notify response team", type: "notify",
          config: {
            recipient: "kethanvr@gmail.com",
            subject: "Urgent customer escalation approved",
            body: "The customer escalation was approved and completed successfully.\n\nCustomer message: {{input.message}}\nSaved output ID: {{previousOutput.outputId}}\n\nThis notification was delivered by AgentWeave.",
          },
        },
      ],
      triggers: [
        { id: randomUUID(), type: "manual", config: {}, isActive: true },
        { id: randomUUID(), type: "webhook", config: {}, secret: randomUUID().replaceAll("-", ""), isActive: true },
        { id: randomUUID(), type: "scheduled", config: { interval_minutes: 60 }, isActive: false },
        { id: randomUUID(), type: "database_event", config: {}, isActive: false },
      ],
    };
  }

  return (
    <WorkflowEditor
      workflowId={workflowId}
      organizationId={org ?? workflowId}
      isNew={isNew}
      initialDraft={initialDraft}
    />
  );
}
