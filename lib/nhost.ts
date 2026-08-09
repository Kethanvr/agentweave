import { createClient } from "@nhost/nhost-js";

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || "local";
const region = process.env.NEXT_PUBLIC_NHOST_REGION || "local";

export const nhost = createClient({ subdomain, region });

export const graphqlHttpUrl = nhost.graphql.url;
export const graphqlWsUrl = graphqlHttpUrl.replace(/^http/, "ws");

