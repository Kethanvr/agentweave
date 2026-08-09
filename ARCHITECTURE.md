# AgentWeave Architecture

## System shape

```text
Next.js / Apollo / Nhost Auth
             |
       GraphQL + JWT
             v
       Hasura GraphQL <---------------- GraphQL subscription
        |          |
   PostgreSQL   Actions / Event / Cron handlers
                    |
                    v
             Nhost Functions
                    |
              startWorkflow()
              /      |      \
          Gemini   HTTPS   Resend
```

The browser talks to Hasura with the user's Nhost access token. Ordinary reads and writes are handled by Hasura; sensitive compound operations are Hasura Actions backed by Nhost Functions. Hasura Event and Cron Triggers use the same Function boundary and webhook-secret validation.

## Tenancy and authorization

`organizations` is the tenancy root. `org_members` maps an Nhost user ID to an organization and an application role: owner, editor, or viewer. Business tables either carry `org_id` directly or reach it through `workflow_id` or `workflow_run_id` relationships.

One global Nhost role is enough: authenticated requests use Hasura's `user` role, while Hasura permission predicates traverse relationships to `org_members` and compare `user_id` with `X-Hasura-User-Id`. A guessed UUID from another organization therefore does not disclose a row. Actions repeat the membership check with admin-side queries before any execution or approval.

Restricted configuration has three enforcement layers:

1. The UI removes `db_write`, `notify`, and webhook controls for non-owners.
2. Hasura column/row checks reject direct restricted mutations by editors and all mutations by viewers.
3. `saveWorkflow` validates the caller, organization membership, role, every step, trigger, and branch target before committing the definition.

The browser restriction is convenience only; backend enforcement remains authoritative.

## Workflow persistence

`workflows` owns ordered `workflow_steps` and `workflow_triggers`. Step configuration is JSONB, allowing a compact type-specific editor while keeping identity, ordering, and authorization relational. Conditional targets are validated to belong to the same submitted workflow and point forward.

`workflow_runs` stores the trigger, actor, input, output, status, and terminal error. `step_runs` is an immutable execution-oriented record of each selected or skipped definition step, including attempts, input, output, timing, approval identity, and error. Its definition reference becomes nullable if a workflow is later edited, preserving historical runs.

## Execution and branching

All entry points converge on one function:

```ts
startWorkflow({ workflowId, triggerType, input, actor })
```

The runner loads the workflow, verifies access or the trusted trigger, checks the current monthly usage row, creates the run, and executes steps by ascending position. Gemini and HTTP operations receive at most two attempts. Each attempt number and terminal error is persisted.

A conditional evaluates equality against a field in the previous output. It jumps only to a later target and records intervening steps as `skipped`. There are no cycles, parallel paths, or merge semantics.

## Approval resume

At an approval gate the runner inserts an `awaiting_approval` step run and marks its parent run `paused`. The filtered `step_runs` subscription immediately updates the page.

`approveStep` verifies the Hasura webhook secret, authenticated user ID, tenant membership, owner/editor role, run state, and step state. A conditional database update changes only an `awaiting_approval` row, records `approved_by` and `approved_at`, and prevents a second approval from winning. The runner resumes from the following position with the stored previous output; completed steps never run again.

## Output, notification, and quota

`db_write` inserts the selected result into `workflow_outputs`. `notify` writes `notification_outbox`; a Hasura Event Trigger invokes the Resend Function, which records sent or failed delivery state on the outbox row.

`organization_usage` stores `calls_used` and `calls_allowed` for each monthly period. Starts are rejected at the limit. Usage increments only after a run reaches `completed`, so paused and failed runs do not consume a call. This intentionally simple model excludes concurrent quota reservations from the assignment scope.

## Realtime boundary

The frontend subscribes to the current `workflow_run` and ordered `step_runs` through Hasura WebSockets. Hasura permissions apply to subscriptions exactly as they do to queries, so the live channel cannot cross organization boundaries.
