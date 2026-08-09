const graphqlUrl = process.env.NHOST_GRAPHQL_URL;
const orgAWorkflowId = process.env.ORG_A_WORKFLOW_ID;
const orgAStepRunId = process.env.ORG_A_STEP_RUN_ID;
const orgBToken = process.env.ORG_B_ACCESS_TOKEN;

if (!graphqlUrl || !orgAWorkflowId || !orgAStepRunId || !orgBToken) {
  throw new Error("Set NHOST_GRAPHQL_URL, ORG_A_WORKFLOW_ID, ORG_A_STEP_RUN_ID, and ORG_B_ACCESS_TOKEN.");
}

async function request(query: string, variables: Record<string, unknown>) {
  const response = await fetch(graphqlUrl!, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${orgBToken}` },
    body: JSON.stringify({ query, variables }),
  });
  return response.json() as Promise<{ data?: Record<string, unknown>; errors?: Array<{ message: string; extensions?: { code?: string } }> }>;
}

async function main() {
  const guessedRead = await request(`
    query GuessWorkflow($id: uuid!) { workflows_by_pk(id: $id) { id name } }
  `, { id: orgAWorkflowId });
  if (guessedRead.data?.workflows_by_pk !== null) {
    throw new Error("Cross-organization workflow read was not isolated.");
  }

  const guessedRun = await request(`
    mutation GuessRun($id: uuid!) { triggerWorkflowRun(workflowId: $id, input: {}) { runId status } }
  `, { id: orgAWorkflowId });
  if (!guessedRun.errors?.length) throw new Error("Cross-organization workflow trigger unexpectedly succeeded.");

  const guessedApproval = await request(`
    mutation GuessApproval($id: uuid!) { approveStep(stepRunId: $id) { runId status } }
  `, { id: orgAStepRunId });
  if (!guessedApproval.errors?.length) throw new Error("Cross-organization approval unexpectedly succeeded.");

  console.log("PASS: Org B cannot read the Org A workflow by ID.");
  console.log("PASS: Org B cannot trigger the Org A workflow by ID.");
  console.log("PASS: Org B cannot approve the Org A step by ID.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
