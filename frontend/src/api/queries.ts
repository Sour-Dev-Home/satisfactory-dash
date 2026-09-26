import {
  infiniteQueryOptions,
  MutationCache,
  QueryCache,
  QueryClient,
  queryOptions,
  type QueryKey,
} from "@tanstack/react-query";
import { endpoints, type HistoryRange, type SessionResponse, type TransitionRange } from "@satisfactory-dash/shared";
import { apiGetAbortable, apiGetQuery } from "./client";
import { BackendUnreachableError, classifyError } from "./errors";

/** ADR-0005 poll intervals. Settings poll only while a change is pending. */
export const POLL_MS = {
  status: 10_000,
  power: 10_000,
  factory: 30_000,
  settingsPending: 10_000,
  alerts: 60_000,
  command: 1_000,
} as const;

/** Alert log events per page (the backend allows 1 to 100). */
export const ALERT_PAGE = 50;

/** A relayed command's statuses that won't change again (ADR-0031). Anything else is still on its way. */
export const FINAL_COMMAND_STATUSES: readonly string[] = ["succeeded", "failed", "expired"];

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

/** The operator's list of stored connections (ADR-0030). */
export const MANAGED_KEY = ["serverManagement"] as const;

/**
 * Marks the session signed out and drops every other cached response, so no data from the
 * old session stays on screen. The auth gate reacts to the session and shows the login screen.
 * Pass the backend's signed-out answer when there is one: it says which sign-in methods to
 * offer (e.g. Google), which the bare fallback can't.
 */
export function signOutLocally(client: QueryClient, answer?: SessionResponse): void {
  client.setQueryData(SESSION_KEY, answer && !answer.authenticated ? answer : signedOut);
  dropSessionData(client);
}

function dropSessionData(client: QueryClient): void {
  client.removeQueries({ predicate: (query) => !keyEquals(query.queryKey, SESSION_KEY) });
}

/**
 * True once the cached session says signed out (unknown is not signed out). A write that
 * finishes after sign-out (e.g. a slow PUT) checks this so it doesn't put the old session's
 * data back into the cache.
 */
export function isSignedOut(client: QueryClient): boolean {
  return client.getQueryData<SessionResponse>(SESSION_KEY)?.authenticated === false;
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
    queryCache: new QueryCache({
      onError: onUnauthorized,
      // A session check can also end the session without any 401 (e.g. a focus refetch after
      // the cookie expired). Drop the old session's data then too. setQueryData doesn't pass
      // through here, so signOutLocally can't recurse.
      onSuccess: (data, query) => {
        if (keyEquals(query.queryKey, SESSION_KEY) && (data as SessionResponse).authenticated === false) {
          dropSessionData(client);
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (!keyEquals(mutation.options.mutationKey, LOGIN_MUTATION_KEY)) onUnauthorized(error);
      },
    }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        // Once signed out, only the session check may run. A view still mounted for one more
        // render after sign-out would otherwise re-create a dropped query and send it with the
        // expired session (a view reading several queries re-renders on any of them).
        enabled: (query) => keyEquals(query.queryKey, SESSION_KEY) || !isSignedOut(client),
      },
      mutations: { retry: false },
    },
  });
  return client;
}

// TanStack Query dedupes by key, so each query has at most one request in flight: an
// interval tick that lands while a fetch is still running joins it instead of starting another.
export const queries = {
  health: () =>
    queryOptions({ queryKey: ["health"], queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.health) }),
  session: () =>
    queryOptions({ queryKey: SESSION_KEY, queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.auth.session) }),
  servers: () =>
    queryOptions({ queryKey: ["servers"], queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.servers) }),
  status: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "status"],
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.status, serverId),
      refetchInterval: POLL_MS.status,
    }),
  /** Who is connected (ADR-0029): live only, polled with the status that counts them. */
  players: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "players"],
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.players, serverId),
      refetchInterval: POLL_MS.status,
    }),
  power: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "power"],
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.power, serverId),
      refetchInterval: POLL_MS.power,
    }),
  // ADR-0022: loaded once per mount (and on refocus); regular power polls are appended to it
  // client-side (PowerHistoryView), so it has no refetchInterval of its own.
  powerHistory: (serverId: string, sessionName?: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "power", "history", sessionName],
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.powerHistory, serverId),
    }),
  /** ADR-0027: stored power history for a range (the backend picks the resolution). Loaded
   *  once per range and on refocus; the newest bucket moves at most about once a minute. */
  historyPower: (serverId: string, range: HistoryRange) =>
    queryOptions({
      queryKey: ["servers", serverId, "history", "power", range],
      queryFn: ({ signal }) => apiGetQuery(signal, endpoints.history.power, { range }, serverId),
      staleTime: 60_000,
    }),
  // The Factory page's history (ADR-0027 PR 8b): every item's series for a range (top 50, highest
  // rate first), and machine state changes. Like historyPower, stored data refreshed on a visit.
  historyItems: (serverId: string, range: HistoryRange) =>
    queryOptions({
      queryKey: ["servers", serverId, "history", "items", range],
      queryFn: ({ signal }) => apiGetQuery(signal, endpoints.history.items, { range }, serverId),
      staleTime: 60_000,
    }),
  historyTransitions: (serverId: string, range: TransitionRange, limit: number) =>
    queryOptions({
      queryKey: ["servers", serverId, "history", "transitions", range, limit],
      queryFn: ({ signal }) => apiGetQuery(signal, endpoints.history.transitions, { range, limit }, serverId),
      staleTime: 60_000,
    }),
  factory: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "factory"],
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.factory, serverId),
      refetchInterval: POLL_MS.factory,
    }),
  // ADR-0030, operator only: every stored connection, with what the edit form needs. Not under
  // ["servers", ...], so ServerGate's "the selected server is gone" handling never sees it.
  managedServers: () =>
    queryOptions({
      queryKey: MANAGED_KEY,
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.serverManagement.list),
    }),
  // ADR-0031 PR 4: a change relayed through the edge agent, followed to its result. Polled about once
  // a second while it's on its way (it usually lands within seconds), never once it's final.
  command: (serverId: string, commandId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "commands", commandId],
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.commands.get, serverId, commandId),
      refetchInterval: (query) => {
        const status = query.state.data?.command.status;
        return status !== undefined && FINAL_COMMAND_STATUSES.includes(status) ? false : POLL_MS.command;
      },
    }),
  // ADR-0027 PR 9: alerts. Alerts change on minute scales, and the header bell reads the status on
  // every page, so it's polled once a minute (never at the page's rate).
  alertStatus: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "alerts", "status"],
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.alerts.status, serverId),
      refetchInterval: POLL_MS.alerts,
      staleTime: POLL_MS.alerts,
    }),
  alertRules: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "alerts", "rules"],
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.alerts.rules.list, serverId),
    }),
  alertDestinations: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "alerts", "destinations"],
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.alerts.destinations.get, serverId),
    }),
  /**
   * The alert log, newest first, a page at a time: each page's `nextBefore` fetches the older one.
   * Read when the bell's dropdown opens (the caller enables it then), fresh for a minute, and never
   * polled in the background: only the badge's status is.
   */
  alertEvents: (serverId: string) =>
    infiniteQueryOptions({
      queryKey: ["servers", serverId, "alerts", "events"],
      queryFn: ({ signal, pageParam }) =>
        apiGetQuery(signal, endpoints.alerts.events, { limit: ALERT_PAGE, before: pageParam }, serverId),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page) => page.nextBefore ?? undefined,
      staleTime: POLL_MS.alerts,
    }),
  settings: (serverId: string) =>
    queryOptions({
      queryKey: ["servers", serverId, "settings"],
      queryFn: ({ signal }) => apiGetAbortable(signal, endpoints.settings.get, serverId),
      // ADR-0012: the setting rarely changes; re-read it only until a pending change applies,
      // or while it's stale (the toggle is held until a fresh read arrives).
      refetchInterval: (query) =>
        query.state.data?.data.pending || query.state.data?.stale ? POLL_MS.settingsPending : false,
    }),
};
