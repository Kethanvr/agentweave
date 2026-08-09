# AgentWeave — Secure Multi-Tenant AI Workflow Orchestration Platform

<p align="center">
  <img src="public/logo.png" alt="AgentWeave logo" width="190" />
</p>

<p align="center">
  <img src="public/readme/hero.png" alt="AgentWeave secure AI workflow orchestration" width="100%" />
</p>

AgentWeave is a working multi-tenant workflow application built with Next.js, Nhost Auth, Hasura GraphQL, PostgreSQL, Nhost Functions, Gemini, and Resend. It demonstrates organization-scoped authorization, live execution updates, protected approval/resume, quota enforcement, and four ways to start the same workflow runner.

## Live deployment

| Service | URL |
| --- | --- |
| Application | [agentweave.kethanvr.tech](https://agentweave.kethanvr.tech) |
| Reviewer login | [agentweave.kethanvr.tech/login](https://agentweave.kethanvr.tech/login) |
| Nhost GraphQL API | [nfldghkngnbyryttgdkh.graphql.ap-south-1.nhost.run/v1](https://nfldghkngnbyryttgdkh.graphql.ap-south-1.nhost.run/v1) |
| Nhost Auth health | [nfldghkngnbyryttgdkh.auth.ap-south-1.nhost.run/v1/healthz](https://nfldghkngnbyryttgdkh.auth.ap-south-1.nhost.run/v1/healthz) |
| Source | [github.com/Kethanvr/agentweave](https://github.com/Kethanvr/agentweave) |

## Demonstrated scenario

```text
Customer message
  -> Gemini structured classification
  -> conditional urgent/non-urgent branch
  -> HTTPS request on the urgent path
  -> approval gate pauses the run
  -> owner/editor approval resumes it
  -> PostgreSQL output is saved
  -> notification outbox row is inserted
  -> Hasura Event Trigger invokes Resend
  -> run completes and quota increments
```

The workflow detail page streams `step_runs` over GraphQL subscriptions, so running, skipped, awaiting-approval, failed, and completed states appear without a refresh.

<p align="center">
  <img src="public/readme/workflow-lifecycle.png" alt="AgentWeave customer escalation workflow lifecycle" width="100%" />
</p>

## Product walkthrough

### Reviewer-ready login

The hosted login exposes clearly labeled Owner, Editor, and Viewer accounts for assignment review. The warning card makes clear that these shared credentials are a demo-only convenience.

<p align="center">
  <img src="public/readme/login.png" alt="AgentWeave production login with public reviewer accounts" width="100%" />
</p>

### Completed AI workflow

The production run shows the Gemini classifier, conditional routing, HTTPS enrichment, human approval, database write, and notification steps completing in one live execution timeline.

<p align="center">
  <img src="public/readme/workflow-completed.png" alt="Completed Customer Escalation Workflow with live execution timeline" width="100%" />
</p>

### Workflow dashboard and usage

The organization dashboard exposes role context, monthly quota usage, workflow definitions, and the latest completed or failed run state without mixing data across tenants.

<p align="center">
  <img src="public/readme/workflow-dashboard.png" alt="AgentWeave workflow dashboard with organization role, quota, and run states" width="100%" />
</p>

### Event-driven email delivery

The notification is inserted into PostgreSQL, delivered through a Hasura Event Trigger to the Nhost Function, accepted by Resend, and received in the destination inbox.

| Resend delivery confirmation | Received email |
| --- | --- |
| <img src="public/readme/resend-delivered.png" alt="Resend dashboard showing the AgentWeave email as delivered" width="100%" /> | <img src="public/readme/email-received.png" alt="AgentWeave production verification email received in Gmail" width="100%" /> |

## Run the production workflow

1. Open the [reviewer login](https://agentweave.kethanvr.tech/login), choose **Owner**, and sign in with the displayed demo password.
2. On **Workflows**, confirm the organization is **Northstar Support**, the badge is **Owner**, and quota is available.
3. Select **New workflow**. AgentWeave preloads the six-step **Customer Escalation Workflow**.
4. Confirm the important configuration before saving:

   ```text
   Gemini model: gemini-3.6-flash
   Conditional field: priority
   Conditional value: URGENT
   Urgent target: Enrich incident
   False target: Human approval
   HTTP URL: https://postman-echo.com/post
   Notify recipient: an email address you can verify
   Manual trigger: enabled
   ```

5. Set the notification recipient to an email address you can verify. Keep `db_write` and `notify` as owner-only steps.
6. Select **Save** and wait for `Workflow saved securely.` The **Run** button becomes available only after a successful save.
7. Use this run input:

   ```json
   {
     "message": "Customer says their production system has been down for 5 hours."
   }
   ```

8. Select **Run**. The live monitor should show Gemini classification, the urgent branch, and the HTTPS enrichment step.
9. When the run becomes **paused**, select **Approve** on the awaiting approval step.
10. Confirm the same run resumes at `db_write`, queues the notification, reaches **completed**, and increments monthly usage by one.
11. Confirm the notification outbox is `sent` and the message arrives through Resend.

> [!IMPORTANT]
> The hosted demo sends from `notifications@emailagentweave.kethanvr.tech`, a verified Resend domain. It can deliver to any valid recipient. Delivery normally occurs within a few seconds after approval and workflow completion; Hasura retries temporary Event Trigger failures twice at 10-second intervals.

### Manual role and isolation checks

- **Editor:** sign in as `editor@orga.agentweave.demo`; safe steps, execution, and approval are available, while owner-only restricted configuration remains unavailable.
- **Viewer:** sign in as `viewer@orga.agentweave.demo`; verify there is no **New workflow**, **Save**, **Run**, or **Approve** control.
- **Org B:** sign in as `editor@orgb.agentweave.demo`; an Org A workflow ID must not appear in queries, and guessed trigger/approval IDs must return `FORBIDDEN`.
- **Duplicate approval:** approve the same `stepRunId` twice; the second request must fail and must not resume the run again.
- **Quota:** set an organization's allowance to its current usage, then confirm a new start returns `QUOTA_EXHAUSTED`; restore the allowance after the check.

The exact GraphQL attack queries and expected responses are documented in [DEMO.md](./DEMO.md).

## Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS
- Nhost Auth and Node.js 22 Functions
- PostgreSQL 14 and Hasura GraphQL
- Apollo Client and `graphql-ws`
- Gemini structured output
- Resend email delivery through a Hasura Event Trigger
- Vercel frontend and Nhost Cloud backend

## Architecture

<p align="center">
  <img src="public/readme/architecture.png" alt="AgentWeave application architecture" width="100%" />
</p>

The browser authenticates with Nhost and uses Hasura queries, mutations, Actions, and subscriptions. Manual, webhook, scheduled, and database-event entry points converge on the same Nhost Function workflow runner.

## Repository map

```text
app/                         Next.js routes
components/                  auth provider, shell, workflow editor
functions/                   Nhost handlers and shared workflow runner
nhost/migrations/default/    PostgreSQL schema and rollback
nhost/metadata/              Hasura tables, permissions, Actions and triggers
scripts/                     local secret, seed and attack-test utilities
ARCHITECTURE.md              tenancy and execution design
DEMO.md                      recording and reviewer walkthrough
```

## Local setup

Prerequisites: Node.js 20+, Docker, and the [Nhost CLI](https://docs.nhost.io/platform/cli/local-development).

1. Install dependencies and create local Nhost secrets.

   ```bash
   npm install
   ./scripts/generate-local-secrets.sh
   ```

2. Start Nhost from this directory.

   ```bash
   nhost up
   ```

   Migrations and metadata are applied by the CLI. Confirm the metadata status in the local Hasura console before continuing.

3. Copy the environment template.

   ```bash
   cp .env.example .env.local
   ```

   Replace the local admin secret with the value in the ignored `.secrets` file. The included demo password is intentionally public for reviewer access; use the same value for `DEMO_PASSWORD` and `NEXT_PUBLIC_DEMO_PASSWORD` when seeding. Replace or remove it outside this demonstration.

4. Seed two organizations and five role-specific users.

   ```bash
   set -a
   source .env.local
   set +a
   npm run demo:seed
   ```

   The seed is idempotent. It creates:

   | Account | Organization | Role |
   | --- | --- | --- |
   | `owner@orga.agentweave.demo` | Northstar Support | owner |
   | `editor@orga.agentweave.demo` | Northstar Support | editor |
   | `viewer@orga.agentweave.demo` | Northstar Support | viewer |
   | `owner@orgb.agentweave.demo` | Helix Operations | owner |
   | `editor@orgb.agentweave.demo` | Helix Operations | editor |

   The login page shows these accounts and the shared password for easy reviewer access. This is a deliberate demo-only exception and is prominently labeled for removal in a real deployment.

5. Start the frontend.

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

### Local HTTP mode

`nhost up --disable-tls` is also supported. In that mode, set the script URLs to `http://local.auth.local.nhost.run:443/v1` and `http://local.graphql.local.nhost.run:443/v1`. The browser client normally uses the standard TLS-enabled local Nhost URLs.

## Secrets and environment variables

Browser variables:

```text
NEXT_PUBLIC_NHOST_SUBDOMAIN
NEXT_PUBLIC_NHOST_REGION
NEXT_PUBLIC_DEMO_PASSWORD
```

Nhost Cloud secrets:

```text
GEMINI_API_KEY
RESEND_API_KEY
```

Nhost Cloud Function environment variables:

```text
GEMINI_API_KEY={{ secrets.GEMINI_API_KEY }}
RESEND_API_KEY={{ secrets.RESEND_API_KEY }}
RESEND_FROM_EMAIL=AgentWeave <notifications@emailagentweave.kethanvr.tech>
DEMO_NOTIFICATION_EMAIL
```

Resend accepts any sender mailbox under the verified `emailagentweave.kethanvr.tech` domain; the mailbox does not need a separate Resend identity.

Nhost supplies `NHOST_GRAPHQL_URL`, `NHOST_ADMIN_SECRET`, and `NHOST_WEBHOOK_SECRET` to Functions. Gemini, Hasura admin, Resend, and webhook secrets are never sent to the browser.

## Security model

All users authenticate under the normal Hasura `user` role. Organization authority is derived from `org_members`, where each membership is `owner`, `editor`, or `viewer`.

- Hasura row permissions scope every query and mutation through organization membership.
- Owners may configure every step and trigger and manage memberships.
- Editors may run, approve, and edit safe workflow configuration.
- Viewers are read-only.
- `db_write`, `notify`, and webhook configuration are owner-only.
- The frontend hides unavailable controls, Hasura blocks direct mutations, and `saveWorkflow` independently validates the full submitted graph.
- All Nhost handlers validate Hasura's webhook secret; user Actions additionally validate the forwarded JWT claims.
- HTTP steps allow only HTTPS GET/POST/PUT/PATCH, reject loopback destinations, cap execution at 10 seconds, reject redirects, and limit responses to 256 KiB.

For the full request and data flow, see [ARCHITECTURE.md](./ARCHITECTURE.md).

<p align="center">
  <img src="public/readme/multi-tenant-security.png" alt="AgentWeave multi-tenant authorization layers" width="100%" />
</p>

## GraphQL API

Hasura Actions expose:

- `saveWorkflow(input)` — validates and atomically saves the workflow, steps, and triggers.
- `triggerWorkflowRun(workflowId, input)` — owner/editor manual execution.
- `triggerWorkflowWebhook(workflowId, secret, input)` — public endpoint with a hashed workflow secret.
- `approveStep(stepRunId)` — one-time owner/editor approval and protected resume.

Manual Actions, webhook Actions, cron events, and database events all call the same `startWorkflow({ workflowId, triggerType, input, actor })` implementation.

## Verification

Run static checks:

```bash
npm run lint
npm run typecheck
npm run build
```

With Nhost running and the seed environment loaded, run the tenant attack suite:

```bash
npm run security:test
```

The checked scenario verifies that Org B receives `null` when querying an Org A workflow ID and `FORBIDDEN` when attempting to run or approve Org A data. The local integration pass also covers viewer denial, editor restricted-step denial, successful approval/resume, duplicate-approval rejection, quota increment, webhook-secret rejection, database-event execution, and scheduled execution.

## Deployment

The production frontend is deployed on Vercel at `agentweave.kethanvr.tech`; the backend project is `nfldghkngnbyryttgdkh` in Nhost `ap-south-1`.

1. Connect this repository to Nhost so migrations, metadata, and root `functions/` deploy together.
2. Add the two integration secrets and four Function environment variables listed above. Use a verified Resend sender/domain.
3. Run the bootstrap script against the Cloud Auth and GraphQL URLs using the Cloud admin secret and the shared demo password.
4. Import the repository into Vercel and set `NEXT_PUBLIC_NHOST_SUBDOMAIN`, `NEXT_PUBLIC_NHOST_REGION`, and the matching `NEXT_PUBLIC_DEMO_PASSWORD`.
5. Add the Vercel origin to the Nhost Auth client URL and allowed redirect URLs, then repeat the security checks and the walkthrough in [DEMO.md](./DEMO.md) against production.

No API keys, Hasura admin secrets, webhook secrets, Gemini keys, or Resend keys are committed. The shared demo login is intentionally public and must be removed or replaced before adapting this project for real users.
