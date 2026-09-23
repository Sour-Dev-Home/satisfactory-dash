import { MutationCache, QueryCache, QueryClient, queryOptions, type QueryKey } from "@tanstack/react-query";
import { endpoints, type SessionResponse } from "@satisfactory-dash/shared";
import { apiGet } from "./client";
import { BackendUnreachableError, classifyError } from "./errors";

/** ADR-0005 poll intervals. */
export const POLL_MS = { status: 10_000, power: 10_000, factory: 30_000 } as const;

/**
 * Retry at most once, and only when the backend itself couldn't be reached. An ApiError
 * means the backend already tried and answered (retrying an upstream_unreachable would just
 * hit the game server again), and contract drift won't fix itself. Polling is the retry.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && error instanceof BackendUnreachableError;
}

export const SESSION_KEY = ["auth", "session"] as const;
/** The login form's own 401 is a form error, not an expired session. */
export const LOGIN_MUTATION_KEY = ["auth", "login"] as const;

const signedOut: SessionResponse = { authenticated: false };

/**
 * Marks the session signed out and drops every other cached response, so no data from the
 * old session stays on screen. The auth gate reacts to the session and shows the login screen.
 */
export function signOutLocally(client: QueryClient): void {
  client.setQueryData(SESSION_KEY, signedOut);
  client.removeQueries({ predicate: (query) => !keyEquals(query.queryKey, SESSION_KEY) });
}

function keyEquals(key: QueryKey | undefined, expected: QueryKey): boolean {
  return key?.length === expected.length && expected.every((part, i) => key[i] === part);
}

export function createQueryClient(): QueryClient {
  // Every protected route answers 401 once the session is gone (ADR-0011); handling it here
  // means no screen has to. The login mutation opts out: its 401 is "wrong password".
  const onUnauthorized = (error: unknown) => {
    if (classifyError(error) === "unauthorized") signOutLocally(client);
  };
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: onUnauthorized }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (!keyEquals(mutation.options.mutationKey, LOGIN_MUTATION_KEY)) onUnauthorized(error);
      },
    }),
    defaultOptions: {
      queries: { retry: shouldRetry },
      mutations: { retry: false },
    },
  });
  return client;
}

// TanStack Query dedupes by key, so each query has at most one request in flight: an
// interval tick that lands while a fetch is still running joins it instead of starting another.
export const queries = {
  health: () => queryOptions({ queryKey: ["health"], queryFn: () => apiGet(endpoints.health) }),
  session: () => queryOptions({ queryKey: SESSION_KEY, queryFn: () => apiGet(endpoints.auth.session) }),
  servers: () => queryOptions({ queryKey: ["servers"], queryFn: () => apiGet(endpoints.servers) }),
  status: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "status"],
      queryFn: () => apiGet(endpoints.status, serverId),
      refetchInterval: POLL_MS.status,
    }),
  power: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "power"],
      queryFn: () => apiGet(endpoints.power, serverId),
      refetchInterval: POLL_MS.power,
    }),
  factory: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "factory"],
      queryFn: () => apiGet(endpoints.factory, serverId),
      refetchInterval: POLL_MS.factory,
    }),
  settings: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "settings"],
      queryFn: () => apiGet(endpoints.settings.get, serverId),
    }),
};
