import { createClient } from "@nhost/nhost-js";

const authUrl = process.env.NHOST_AUTH_URL;
const graphqlUrl = process.env.NHOST_GRAPHQL_URL;
const adminSecret = process.env.NHOST_ADMIN_SECRET;
const password = process.env.DEMO_PASSWORD;

if (!authUrl || !graphqlUrl || !adminSecret || !password) {
  throw new Error("Set NHOST_AUTH_URL, NHOST_GRAPHQL_URL, NHOST_ADMIN_SECRET, and DEMO_PASSWORD first.");
}

const nhost = createClient({ authUrl, graphqlUrl });

async function adminGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(graphqlUrl!, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hasura-admin-secret": adminSecret! },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (!response.ok || !body.data || body.errors?.length) {
    throw new Error(body.errors?.map((error) => error.message).join("; ") || `GraphQL returned ${response.status}`);
  }
  return body.data;
}

async function ensureUser(email: string, displayName: string): Promise<string> {
  try {
    const response = await nhost.auth.signUpEmailPassword({
      email,
      password: password!,
      options: { displayName },
    });
    const id = response.body.session?.user?.id;
    if (id) return id;
  } catch {
    // Existing demo users are expected on repeatable runs.
  }
  const response = await nhost.auth.signInEmailPassword({ email, password: password! });
  const id = response.body.session?.user?.id;
  if (!id) throw new Error(`Could not create or sign in ${email}`);
  return id;
}

async function ensureOrganization(name: string, slug: string): Promise<string> {
  const result = await adminGraphql<{ insert_organizations_one: { id: string } }>(`
    mutation EnsureOrganization($object: organizations_insert_input!) {
      insert_organizations_one(
        object: $object
        on_conflict: { constraint: organizations_slug_key, update_columns: [name] }
      ) { id }
    }
  `, { object: { name, slug, calls_allowed: 100 } });
  return result.insert_organizations_one.id;
}

async function addMember(orgId: string, userId: string, role: string): Promise<void> {
  await adminGraphql(`
    mutation EnsureMembership($object: org_members_insert_input!) {
      insert_org_members_one(
        object: $object
        on_conflict: { constraint: org_members_org_id_user_id_key, update_columns: [role] }
      ) { id }
    }
  `, { object: { org_id: orgId, user_id: userId, role } });
}

const accounts = [
  { email: "owner@orga.agentweave.demo", name: "Org A Owner", org: "a", role: "owner" },
  { email: "editor@orga.agentweave.demo", name: "Org A Editor", org: "a", role: "editor" },
  { email: "viewer@orga.agentweave.demo", name: "Org A Viewer", org: "a", role: "viewer" },
  { email: "owner@orgb.agentweave.demo", name: "Org B Owner", org: "b", role: "owner" },
  { email: "editor@orgb.agentweave.demo", name: "Org B Editor", org: "b", role: "editor" },
];

const orgA = await ensureOrganization("Northstar Support", "northstar-support");
const orgB = await ensureOrganization("Helix Operations", "helix-operations");

for (const account of accounts) {
  const userId = await ensureUser(account.email, account.name);
  await addMember(account.org === "a" ? orgA : orgB, userId, account.role);
}

console.log("AgentWeave demo organizations are ready.");
console.log(`Org A: ${orgA}`);
console.log(`Org B: ${orgB}`);
console.log("Accounts:");
for (const account of accounts) console.log(`- ${account.email} (${account.role})`);
console.log("Passwords are read from DEMO_PASSWORD and were not printed.");

