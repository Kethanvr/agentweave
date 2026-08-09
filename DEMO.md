# AgentWeave Demo Walkthrough

This script is designed for a short reviewer recording after the Vercel and Nhost Cloud smoke tests pass. Start at [agentweave.kethanvr.tech/login](https://agentweave.kethanvr.tech/login).

## 1. Happy path

1. Choose the Owner demo account, `owner@orga.agentweave.demo`, and use the password displayed on the login page.
2. In **Northstar Support**, select **New workflow** to load **Customer Escalation Workflow**.
3. Set the Notify recipient to an email address you can verify, then select **Save**.
4. Show the vertical steps, four trigger types, role badge, and quota indicator.
5. Run this input:

   ```text
   Customer says their production system has been down for 5 hours.
   ```

6. Watch Gemini classify it as urgent, the conditional choose the urgent path, and the HTTPS request complete in the live timeline.
7. When the approval card appears, approve the waiting step.
8. Show the run resuming without rerunning earlier steps, the database output being saved, the notification being queued, and the run completing.
9. Show the quota count increasing and the Resend delivery/event result.

## 2. Role enforcement

1. Sign in as `editor@orga.agentweave.demo` and show that safe steps can be edited while `db_write`, `notify`, and webhook configuration are unavailable.
2. Sign in as `viewer@orga.agentweave.demo` and show the read-only builder with no run or approval controls.

## 3. Org B attack attempts

Use the Org A workflow and paused step IDs collected during the happy path. Sign in as `editor@orgb.agentweave.demo`, then send requests through the Hasura API explorer with that user's JWT.

```graphql
query CrossTenantRead($id: uuid!) {
  workflows_by_pk(id: $id) { id name }
}
```

Expected: `workflows_by_pk` is `null`.

```graphql
mutation CrossTenantRun($id: uuid!) {
  triggerWorkflowRun(workflowId: $id, input: {}) { runId status }
}
```

Expected: `FORBIDDEN`.

```graphql
mutation CrossTenantApproval($id: uuid!) {
  approveStep(stepRunId: $id) { runId status }
}
```

Expected: `FORBIDDEN`.

Finish by noting that these checks bypass the UI entirely: organization isolation and restricted operations are enforced in Hasura and revalidated in the Function handlers.

## Pre-recording checklist

- Production Auth redirect and client URLs point to the Vercel origin.
- Gemini and Resend Function secrets are configured in Nhost Cloud.
- The Resend sender is verified and the demo recipient can receive mail.
- The workflow HTTP endpoint is reachable over HTTPS.
- Manual, webhook, scheduled, and database-event smoke tests have run in production.
- `npm run lint`, `npm run typecheck`, and `npm run build` pass from a clean checkout.
- The production URL and intentionally public reviewer password match the login page; real service secrets remain private.
