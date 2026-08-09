import { AppError } from "./http";

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
};

export async function adminGraphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const url = process.env.NHOST_GRAPHQL_URL;
  const adminSecret = process.env.NHOST_ADMIN_SECRET;
  if (!url || !adminSecret) {
    throw new AppError("Nhost GraphQL environment is not configured", "CONFIGURATION", 500);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hasura-admin-secret": adminSecret,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as GraphQLResponse<T>;
  if (!response.ok || payload.errors?.length || !payload.data) {
    const message = payload.errors?.map((error) => error.message).join("; ") || `GraphQL request failed (${response.status})`;
    throw new AppError(message, payload.errors?.[0]?.extensions?.code ?? "GRAPHQL_ERROR", 500);
  }

  return payload.data;
}

export function monthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

