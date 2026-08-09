"use client";

import { gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { Activity, ArrowRight, Clock3, Plus, ShieldCheck, Workflow as WorkflowIcon, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/providers";
import type { OrgRole } from "@/lib/types";

const WORKSPACES = gql`
  query Workspaces($userId: uuid!) {
    organizations(order_by: { name: asc }) {
      id name slug calls_allowed
      memberships(where: { user_id: { _eq: $userId } }) { role }
      workflows(order_by: { updated_at: desc }) {
        id name description is_active updated_at
        steps { id }
        triggers { id type is_active }
        runs(order_by: { created_at: desc }, limit: 1) { id status created_at }
      }
    }
    organization_current_usage { org_id calls_used calls_allowed calls_remaining }
  }
`;

type WorkspaceData = {
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    calls_allowed: number;
    memberships: Array<{ role: OrgRole }>;
    workflows: Array<{
      id: string;
      name: string;
      description: string;
      is_active: boolean;
      updated_at: string;
      steps: Array<{ id: string }>;
      triggers: Array<{ id: string; type: string; is_active: boolean }>;
      runs: Array<{ id: string; status: string; created_at: string }>;
    }>;
  }>;
  organization_current_usage: Array<{
    org_id: string;
    calls_used: number;
    calls_allowed: number;
    calls_remaining: number;
  }>;
};

function statusLabel(status?: string) {
  if (!status) return "Never run";
  return status.replaceAll("_", " ");
}

export default function WorkflowsPage() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? "";
  const { data, loading, error } = useQuery<WorkspaceData>(WORKSPACES, {
    variables: { userId },
    skip: !userId,
    fetchPolicy: "cache-and-network",
  });
  const [selectedOrgId, setSelectedOrgId] = useState("");

  const organization = useMemo(
    () => data?.organizations.find((org) => org.id === selectedOrgId) ?? data?.organizations[0],
    [data, selectedOrgId],
  );
  const usage = data?.organization_current_usage.find((item) => item.org_id === organization?.id);
  const role = organization?.memberships[0]?.role ?? "viewer";
  const usagePercent = usage ? Math.min(100, Math.round((usage.calls_used / usage.calls_allowed) * 100)) : 0;

  if (loading && !data) return <div className="page-loader"><span className="spinner" /> Loading workflows…</div>;

  return (
    <div className="content-page">
      <header className="page-header">
        <div>
          <span className="eyebrow"><Zap size={14} /> Orchestration workspace</span>
          <h1>Workflows</h1>
          <p>Build and monitor secure AI automations across your organization.</p>
        </div>
        {organization && role !== "viewer" && (
          <Link className="button primary" href={`/workflows/new?org=${organization.id}`}>
            <Plus size={17} /> New workflow
          </Link>
        )}
      </header>

      {error && <div className="alert error">{error.message}</div>}
      {!organization ? (
        <div className="empty-state">
          <ShieldCheck size={30} />
          <h2>No organization membership</h2>
          <p>Ask an owner to add your Nhost user to an AgentWeave organization.</p>
        </div>
      ) : (
        <>
          <section className="workspace-bar">
            <div className="org-select-wrap">
              <span className="avatar org">{organization.name.slice(0, 1)}</span>
              <label>
                Organization
                <select value={selectedOrgId || organization.id} onChange={(event) => setSelectedOrgId(event.target.value)}>
                  {data?.organizations.map((org) => <option value={org.id} key={org.id}>{org.name}</option>)}
                </select>
              </label>
              <span className={`role-badge ${role}`}>{role}</span>
            </div>
            <div className="quota-summary">
              <div className="quota-copy">
                <span>Monthly usage</span>
                <strong>{usage?.calls_used ?? 0} / {usage?.calls_allowed ?? organization.calls_allowed} runs</strong>
              </div>
              <div className="progress"><span style={{ width: `${usagePercent}%` }} /></div>
            </div>
          </section>

          <div className="section-heading">
            <div><h2>Your workflows</h2><p>{organization.workflows.length} workflow{organization.workflows.length === 1 ? "" : "s"} in this organization</p></div>
          </div>

          {organization.workflows.length === 0 ? (
            <div className="empty-state">
              <WorkflowIcon size={32} />
              <h2>Create your first workflow</h2>
              <p>Chain Gemini, API calls, conditions, and human approval in one live run.</p>
            </div>
          ) : (
            <div className="workflow-grid">
              {organization.workflows.map((workflow) => {
                const latestRun = workflow.runs[0];
                const triggerCount = workflow.triggers.filter((trigger) => trigger.is_active).length;
                return (
                  <Link className="workflow-card" href={`/workflows/${workflow.id}`} key={workflow.id}>
                    <div className="card-topline">
                      <span className="workflow-icon"><WorkflowIcon size={19} /></span>
                      <span className={`status-pill ${latestRun?.status ?? "idle"}`}><i /> {statusLabel(latestRun?.status)}</span>
                    </div>
                    <div>
                      <h3>{workflow.name}</h3>
                      <p>{workflow.description || "No description yet."}</p>
                    </div>
                    <div className="card-metrics">
                      <span><Activity size={15} /> {workflow.steps.length} steps</span>
                      <span><Zap size={15} /> {triggerCount} triggers</span>
                      <span><Clock3 size={15} /> {new Date(workflow.updated_at).toLocaleDateString()}</span>
                    </div>
                    <span className="card-link">Open workflow <ArrowRight size={16} /></span>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
