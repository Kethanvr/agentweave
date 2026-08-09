"use client";

import {
  ApolloClient,
  HttpLink,
  InMemoryCache,
  split,
} from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { ApolloProvider } from "@apollo/client/react";
import type { Session } from "@nhost/nhost-js/session";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient as createWsClient } from "graphql-ws";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { graphqlHttpUrl, graphqlWsUrl, nhost } from "@/lib/nhost";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

let cachedSession: Session | null = null;
let cachedAccessToken: string | null = null;

function readSession(): Session | null {
  const nextSession = nhost.getUserSession();
  const nextAccessToken = nextSession?.accessToken ?? null;
  if (nextAccessToken !== cachedAccessToken) {
    cachedAccessToken = nextAccessToken;
    cachedSession = nextSession;
  }
  return cachedSession;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside Providers");
  return value;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const session = useSyncExternalStore(
    (onStoreChange) => nhost.sessionStorage.onChange(() => {
      const nextSession = nhost.getUserSession();
      cachedSession = nextSession;
      cachedAccessToken = nextSession?.accessToken ?? null;
      onStoreChange();
    }),
    readSession,
    () => null,
  );
  const loading = false;

  const clients = useMemo(() => {
    const httpLink = new HttpLink({
      uri: graphqlHttpUrl,
      fetch: (uri, options = {}) => {
        const token = nhost.getUserSession()?.accessToken;
        const headers = new Headers(options.headers);
        if (token) headers.set("authorization", `Bearer ${token}`);
        return fetch(uri, { ...options, headers });
      },
    });
    const wsClient = createWsClient({
      url: graphqlWsUrl,
      lazy: true,
      retryAttempts: 5,
      connectionParams: () => {
        const token = nhost.getUserSession()?.accessToken;
        return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
      },
    });
    const wsLink = new GraphQLWsLink(wsClient);
    const link = split(
      ({ query }) => {
        const definition = getMainDefinition(query);
        return definition.kind === "OperationDefinition" && definition.operation === "subscription";
      },
      wsLink,
      httpLink,
    );
    return {
      apollo: new ApolloClient({ link, cache: new InMemoryCache() }),
      dispose: () => wsClient.dispose(),
    };
  }, []);

  useEffect(() => () => { void clients.dispose(); }, [clients]);

  const auth = useMemo<AuthContextValue>(() => ({
    session,
    loading,
    signOut: async () => {
      const current = nhost.getUserSession();
      if (current) await nhost.auth.signOut({ refreshToken: current.refreshToken });
      nhost.clearSession();
    },
  }), [session, loading]);

  return (
    <AuthContext.Provider value={auth}>
      <ApolloProvider client={clients.apollo}>{children}</ApolloProvider>
    </AuthContext.Provider>
  );
}
