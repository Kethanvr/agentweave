"use client";

import { gql } from "@apollo/client";
import { useMutation, useQuery, useSubscription } from "@apollo/client/react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock3,
  Code2,
  Copy,
  Database,
  GitBranch,
  Globe2,
  KeyRound,
  LoaderCircle,
  Mail,
  PauseCircle,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Webhook,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers";
import { graphqlHttpUrl } from "@/lib/nhost";
import type { EditorStep, EditorTrigger, OrgRole, RunStep, StepType, TriggerType } from "@/lib/types";

const EDITOR_DATA = gql`
  query WorkflowEditorData($workflowId: uuid!, $organizationId: uuid!, $userId: uuid!) {
    workflows_by_pk(id: $workflowId) {
      id name description is_active org_id
      steps(order_by: { position: asc }) { id position name type config }
      triggers(order_by: { created_at: asc }) { id type config next_run_at is_active }
    }
    organizations(where: {
      _or: [
        { id: { _eq: $organizationId } }
        { workflows: { id: { _eq: $workflowId } } }
      ]
    }, limit: 1) {
      id name calls_allowed
      memberships(where: { user_id: { _eq: $userId } }) { role }
    }
  }
`;

const LIVE_RUN = gql`
  subscription LiveWorkflowRun($workflowId: uuid!) {
    workflow_runs(
      where: { workflow_id: { _eq: $workflowId } }
      order_by: { created_at: desc }
      limit: 1
    ) {
      id status trigger_type error created_at completed_at
      step_runs(order_by: { position: asc }) {
        id position step_name step_type status attempt_count error output approved_at
      }
    }
  }
`;

const SAVE_WORKFLOW = gql`
  mutation SaveWorkflow($input: SaveWorkflowInput!) {
    saveWorkflow(input: $input) { workflowId }
  }
`;

const TRIGGER_RUN = gql`
  mutation TriggerWorkflow($workflowId: uuid!, $input: jsonb) {
    triggerWorkflowRun(workflowId: $workflowId, input: $input) { runId status }
  }
`;

const APPROVE_STEP = gql`
  mutation ApproveWorkflowStep($stepRunId: uuid!) {
    approveStep(stepRunId: $stepRunId) { runId stepRunId status }
  }
`;

export type InitialWorkflowDraft = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  steps: EditorStep[];
  triggers: EditorTrigger[];
};

type EditorQuery = {
  workflows_by_pk: {
    id: string;
    name: string;
    description: string;
    is_active: boolean;
    org_id: string;
    steps: EditorStep[];
    triggers: Array<{
      id: string;
      type: TriggerType;
      config: Record<string, unknown>;
      next_run_at: string | null;
      is_active: boolean;
    }>;
  } | null;
  organizations: Array<{
    id: string;
    name: string;
    calls_allowed: number;
    memberships: Array<{ role: OrgRole }>;
  }>;
};

type LiveRunData = {
  workflow_runs: Array<{
    id: string;
    status: string;
    trigger_type: string;
    error: string | null;
    created_at: string;
    completed_at: string | null;
    step_runs: RunStep[];
  }>;
};

const STEP_META: Record<StepType, { label: string; icon: typeof Bot; tone: string }> = {
  llm_call: { label: "Gemini", icon: Bot, tone: "violet" },
  http_request: { label: "HTTP request", icon: Globe2, tone: "blue" },
  conditional_branch: { label: "Conditional", icon: GitBranch, tone: "amber" },
  approval_gate: { label: "Approval gate", icon: ShieldCheck, tone: "cyan" },
  db_write: { label: "Database write", icon: Database, tone: "green" },
  notify: { label: "Email notification", icon: Mail, tone: "rose" },
};

const TRIGGER_META: Record<TriggerType, { label: string; icon: typeof Play; description: string }> = {
  manual: { label: "Manual", icon: Play, description: "Start from the Run button" },
  webhook: { label: "Webhook", icon: Webhook, description: "Start from an external GraphQL call" },
  scheduled: { label: "Scheduled", icon: Clock3, description: "Start from the Hasura cron handler" },
  database_event: { label: "Database event", icon: Database, description: "Start when an inbox row is inserted" },
};

export function WorkflowEditor({
  workflowId,
  organizationId,
  isNew,
  initialDraft,
}: {
  workflowId: string;
  organizationId: string;
  isNew: boolean;
  initialDraft?: InitialWorkflowDraft;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? "";
  const { data, loading, error } = useQuery<EditorQuery>(EDITOR_DATA, {
    variables: { workflowId, organizationId, userId },
    skip: !userId,
    fetchPolicy: "cache-and-network",
  });
  const { data: liveData } = useSubscription<LiveRunData>(LIVE_RUN, {
    variables: { workflowId },
    skip: isNew,
  });
  const [saveWorkflow, saveState] = useMutation(SAVE_WORKFLOW);
  const [triggerRun, runState] = useMutation(TRIGGER_RUN);
  const [approveStep, approvalState] = useMutation(APPROVE_STEP);
  const [draft, setDraft] = useState<InitialWorkflowDraft | null>(initialDraft ?? null);
  const [saved, setSaved] = useState(!isNew);
  const [runInput, setRunInput] = useState('{\n  "message": "Customer says their production system has been down for 5 hours."\n}');
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const workflow = data?.workflows_by_pk;
    if (!workflow || draft) return;
    const timer = window.setTimeout(() => setDraft({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        isActive: workflow.is_active,
        steps: workflow.steps,
        triggers: workflow.triggers.map((trigger) => ({
          id: trigger.id,
          type: trigger.type,
          config: trigger.config,
          nextRunAt: trigger.next_run_at,
          isActive: trigger.is_active,
        })),
      }), 0);
    return () => window.clearTimeout(timer);
  }, [data, draft]);

  const organization = data?.organizations[0];
  const orgId = organization?.id ?? (isNew ? organizationId : data?.workflows_by_pk?.org_id ?? organizationId);
  const role = organization?.memberships[0]?.role ?? "viewer";
  const canEdit = role === "owner" || role === "editor";
  const liveRun = liveData?.workflow_runs[0];
  const awaitingApproval = liveRun?.step_runs.find((step) => step.status === "awaiting_approval");

  const webhookTrigger = draft?.triggers.find((trigger) => trigger.type === "webhook");
  const webhookCurl = (() => {
    if (!webhookTrigger?.secret) return "Save a new webhook secret to generate the test command.";
    return `curl '${graphqlHttpUrl}' -H 'content-type: application/json' --data '${JSON.stringify({
      query: "mutation Webhook($workflowId: uuid!, $secret: String!, $input: jsonb) { triggerWorkflowWebhook(workflowId: $workflowId, secret: $secret, input: $input) { runId status } }",
      variables: { workflowId, secret: webhookTrigger.secret, input: { message: "Production has been down for 5 hours" } },
    })}'`;
  })();

  if ((loading && !draft) || !draft) {
    return <div className="page-loader"><span className="spinner" /> Loading workflow…</div>;
  }

  function updateStep(id: string, patch: Partial<EditorStep>) {
    setDraft((current) => current && ({
      ...current,
      steps: current.steps.map((step) => step.id === id ? { ...step, ...patch } : step),
    }));
  }

  function updateConfig(id: string, key: string, value: unknown) {
    const step = draft?.steps.find((item) => item.id === id);
    if (step) updateStep(id, { config: { ...step.config, [key]: value } });
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.steps.length) return;
    const next = [...draft.steps];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft({ ...draft, steps: next.map((step, position) => ({ ...step, position })) });
  }

  function removeStep(id: string) {
    setDraft({ ...draft, steps: draft.steps.filter((step) => step.id !== id).map((step, position) => ({ ...step, position })) });
  }

  function addStep() {
    const id = crypto.randomUUID();
    setDraft({
      ...draft,
      steps: [...draft.steps, { id, position: draft.steps.length, name: "New Gemini step", type: "llm_call", config: { model: "gemini-2.0-flash", prompt: "Process this input as JSON: {{input}}" } }],
    });
  }

  function updateTrigger(type: TriggerType, patch: Partial<EditorTrigger>) {
    const existing = draft.triggers.find((trigger) => trigger.type === type);
    const triggers = existing
      ? draft.triggers.map((trigger) => trigger.type === type ? { ...trigger, ...patch } : trigger)
      : [...draft.triggers, { id: crypto.randomUUID(), type, config: {}, isActive: true, ...patch }];
    setDraft({ ...draft, triggers });
  }

  async function handleSave() {
    setActionError("");
    setNotice("");
    try {
      await saveWorkflow({
        variables: {
          input: {
            id: draft.id,
            organizationId: orgId,
            name: draft.name,
            description: draft.description,
            isActive: draft.isActive,
            steps: draft.steps,
            triggers: draft.triggers.map((trigger) => ({
              id: trigger.id,
              type: trigger.type,
              config: trigger.config,
              secret: trigger.secret || null,
              nextRunAt: trigger.nextRunAt || null,
              isActive: trigger.isActive,
            })),
          },
        },
      });
      setSaved(true);
      setNotice("Workflow saved securely.");
      if (isNew) router.replace(`/workflows/${draft.id}`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Unable to save workflow");
    }
  }

  async function handleRun() {
    setActionError("");
    try {
      const input = JSON.parse(runInput) as Record<string, unknown>;
      await triggerRun({ variables: { workflowId: draft.id, input } });
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Unable to start workflow");
    }
  }

  async function handleApprove(stepRunId: string) {
    setActionError("");
    try {
      await approveStep({ variables: { stepRunId } });
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Unable to approve this step");
    }
  }

  return (
    <div className="editor-page">
      <header className="editor-header">
        <div className="editor-title-row">
          <Link href="/workflows" className="icon-button bordered" aria-label="Back to workflows"><ArrowLeft size={18} /></Link>
          <div>
            <div className="breadcrumb">Workflows <span>/</span> {isNew ? "New workflow" : draft.name}</div>
            <input className="title-input" value={draft.name} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </div>
        </div>
        <div className="header-actions">
          <span className={`role-badge ${role}`}>{role}</span>
          {canEdit && <button className="button secondary" onClick={handleSave} disabled={saveState.loading}><Save size={16} /> {saveState.loading ? "Saving…" : "Save"}</button>}
          {role !== "viewer" && <button className="button primary" onClick={handleRun} disabled={!saved || runState.loading}><Play size={16} fill="currentColor" /> {runState.loading ? "Running…" : "Run"}</button>}
        </div>
      </header>

      {(error || actionError) && <div className="alert error editor-alert"><AlertTriangle size={17} /> {actionError || error?.message}</div>}
      {notice && <div className="alert success editor-alert"><CheckCircle2 size={17} /> {notice}</div>}

      <div className="editor-grid">
        <section className="builder-panel">
          <div className="panel-heading">
            <div><span className="eyebrow"><Braces size={14} /> Workflow definition</span><h2>Steps</h2></div>
            {canEdit && <button className="button ghost" onClick={addStep}><Plus size={16} /> Add step</button>}
          </div>
          <label className="description-field">
            Description
            <textarea value={draft.description} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} />
          </label>

          <div className="step-list">
            {draft.steps.map((step, index) => (
              <StepCard
                key={step.id}
                step={step}
                index={index}
                allSteps={draft.steps}
                role={role}
                disabled={!canEdit}
                onChange={(patch) => updateStep(step.id, patch)}
                onConfig={(key, value) => updateConfig(step.id, key, value)}
                onMove={moveStep}
                onRemove={() => removeStep(step.id)}
              />
            ))}
          </div>
        </section>

        <aside className="inspector-panel">
          <section className="side-section">
            <div className="panel-heading compact"><div><span className="eyebrow"><Zap size={14} /> Start workflow</span><h2>Triggers</h2></div></div>
            <div className="trigger-list">
              {(Object.keys(TRIGGER_META) as TriggerType[]).map((type) => {
                const meta = TRIGGER_META[type];
                const trigger = draft.triggers.find((item) => item.type === type);
                const Icon = meta.icon;
                const restricted = type === "webhook" && role !== "owner";
                return (
                  <div className={`trigger-card ${trigger?.isActive ? "enabled" : ""}`} key={type}>
                    <span className="trigger-icon"><Icon size={17} /></span>
                    <div className="trigger-copy"><strong>{meta.label}</strong><small>{meta.description}</small></div>
                    <label className="toggle">
                      <input type="checkbox" checked={trigger?.isActive ?? false} disabled={!canEdit || restricted} onChange={(event) => updateTrigger(type, { isActive: event.target.checked })} />
                      <span />
                    </label>
                    {type === "webhook" && trigger?.isActive && role === "owner" && (
                      <label className="trigger-extra">Secret<input type="password" value={trigger.secret ?? ""} placeholder="Unchanged when blank" onChange={(event) => updateTrigger(type, { secret: event.target.value })} /></label>
                    )}
                    {type === "scheduled" && trigger?.isActive && (
                      <label className="trigger-extra">Every (minutes)<input type="number" min={1} value={Number(trigger.config.interval_minutes ?? 60)} onChange={(event) => updateTrigger(type, { config: { ...trigger.config, interval_minutes: Number(event.target.value) } })} /></label>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="side-section run-section">
            <div className="panel-heading compact"><div><span className="eyebrow"><Code2 size={14} /> Live execution</span><h2>Run monitor</h2></div>{liveRun && <span className={`status-pill ${liveRun.status}`}><i /> {liveRun.status}</span>}</div>
            <label>Run input<textarea className="code-input" rows={5} value={runInput} onChange={(event) => setRunInput(event.target.value)} /></label>
            {liveRun ? (
              <div className="run-timeline">
                <div className="run-meta"><span>{liveRun.trigger_type} trigger</span><small>{new Date(liveRun.created_at).toLocaleTimeString()}</small></div>
                {liveRun.step_runs.map((step) => <RunStepRow step={step} key={step.id} />)}
                {awaitingApproval && role !== "viewer" && (
                  <button className="button approve wide" onClick={() => handleApprove(awaitingApproval.id)} disabled={approvalState.loading}>
                    <ShieldCheck size={17} /> {approvalState.loading ? "Approving…" : "Approve and resume"}
                  </button>
                )}
                {liveRun.error && <div className="alert error small-alert">{liveRun.error}</div>}
              </div>
            ) : <div className="run-empty"><CircleDashed size={24} /><span>No runs yet</span><small>Save and run this workflow to stream every step here.</small></div>}
          </section>

          {webhookTrigger?.isActive && (
            <details className="webhook-test">
              <summary><KeyRound size={15} /> Webhook test command</summary>
              <div className="code-block"><code>{webhookCurl}</code><button className="icon-button" onClick={() => navigator.clipboard.writeText(webhookCurl)}><Copy size={15} /></button></div>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}

function StepCard({ step, index, allSteps, role, disabled, onChange, onConfig, onMove, onRemove }: {
  step: EditorStep;
  index: number;
  allSteps: EditorStep[];
  role: OrgRole;
  disabled: boolean;
  onChange: (patch: Partial<EditorStep>) => void;
  onConfig: (key: string, value: unknown) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  const allowedTypes = (Object.keys(STEP_META) as StepType[]).filter((type) => role === "owner" || !["db_write", "notify"].includes(type));
  const laterSteps = allSteps.filter((candidate) => candidate.position > step.position);

  return (
    <article className={`step-card tone-${meta.tone}`}>
      <div className="step-card-header">
        <span className="step-number">{index + 1}</span>
        <span className="step-icon"><Icon size={18} /></span>
        <div className="step-identity">
          <input value={step.name} disabled={disabled} onChange={(event) => onChange({ name: event.target.value })} />
          <span>{meta.label}</span>
        </div>
        {!disabled && <div className="step-actions"><button onClick={() => onMove(index, -1)} disabled={index === 0}><ChevronUp size={16} /></button><button onClick={() => onMove(index, 1)} disabled={index === allSteps.length - 1}><ChevronDown size={16} /></button><button onClick={onRemove}><Trash2 size={16} /></button></div>}
        <button className="collapse-button" onClick={() => setOpen(!open)}><ChevronDown size={17} className={open ? "rotated" : ""} /></button>
      </div>
      {open && (
        <div className="step-config">
          <label>Step type<select value={step.type} disabled={disabled} onChange={(event) => onChange({ type: event.target.value as StepType, config: {} })}>{allowedTypes.map((type) => <option key={type} value={type}>{STEP_META[type].label}</option>)}</select></label>
          {step.type === "llm_call" && <><label>Model<input value={String(step.config.model ?? "gemini-2.0-flash")} disabled={disabled} onChange={(event) => onConfig("model", event.target.value)} /></label><label className="full">Prompt<textarea rows={3} value={String(step.config.prompt ?? "")} disabled={disabled} onChange={(event) => onConfig("prompt", event.target.value)} /></label></>}
          {step.type === "http_request" && <><label>Method<select value={String(step.config.method ?? "GET")} disabled={disabled} onChange={(event) => onConfig("method", event.target.value)}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option></select></label><label>HTTPS URL<input value={String(step.config.url ?? "")} disabled={disabled} onChange={(event) => onConfig("url", event.target.value)} /></label><label className="full">Request body template<textarea rows={2} value={String(step.config.body ?? "{{previousOutput}}")} disabled={disabled} onChange={(event) => onConfig("body", event.target.value)} /></label></>}
          {step.type === "conditional_branch" && <><label>Output field<input value={String(step.config.field ?? "priority")} disabled={disabled} onChange={(event) => onConfig("field", event.target.value)} /></label><label>Equals<input value={String(step.config.value ?? "URGENT")} disabled={disabled} onChange={(event) => onConfig("value", event.target.value)} /></label><label>When true<select value={String(step.config.true_step_id ?? "")} disabled={disabled} onChange={(event) => onConfig("true_step_id", event.target.value)}><option value="">Select target</option>{laterSteps.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.position + 1}. {candidate.name}</option>)}</select></label><label>When false<select value={String(step.config.false_step_id ?? "")} disabled={disabled} onChange={(event) => onConfig("false_step_id", event.target.value)}><option value="">Select target</option>{laterSteps.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.position + 1}. {candidate.name}</option>)}</select></label></>}
          {step.type === "approval_gate" && <label className="full">Approval instructions<textarea rows={2} value={String(step.config.instructions ?? "")} disabled={disabled} onChange={(event) => onConfig("instructions", event.target.value)} /></label>}
          {step.type === "db_write" && <div className="owner-note full"><Database size={16} /><span><strong>Owner-only step</strong> Saves the previous result in AgentWeave&apos;s audited workflow output table.</span></div>}
          {step.type === "notify" && <><label>Recipient<input type="email" value={String(step.config.recipient ?? "")} disabled={disabled} placeholder="alerts@company.com" onChange={(event) => onConfig("recipient", event.target.value)} /></label><label>Subject<input value={String(step.config.subject ?? "")} disabled={disabled} onChange={(event) => onConfig("subject", event.target.value)} /></label><label className="full">Email body<textarea rows={2} value={String(step.config.body ?? "")} disabled={disabled} onChange={(event) => onConfig("body", event.target.value)} /></label></>}
        </div>
      )}
    </article>
  );
}

function RunStepRow({ step }: { step: RunStep }) {
  const icons = {
    completed: <Check size={14} />,
    failed: <XCircle size={14} />,
    awaiting_approval: <PauseCircle size={14} />,
    running: <LoaderCircle size={14} className="spin" />,
    skipped: <ChevronDown size={14} />,
    queued: <Clock3 size={14} />,
  };
  return (
    <details className={`run-step ${step.status}`}>
      <summary><span className="run-step-status">{icons[step.status]}</span><span><strong>{step.step_name}</strong><small>{step.status.replaceAll("_", " ")} · attempt {step.attempt_count}</small></span></summary>
      {(step.output !== null || step.error) && <pre>{step.error ?? JSON.stringify(step.output, null, 2)}</pre>}
    </details>
  );
}
