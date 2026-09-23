import { QueryClient, queryOptions } from "@tanstack/react-query";
import { endpoints } from "@satisfactory-dash/shared";
import { apiGet } from "./client";
import { BackendUnreachableError } from "./errors";

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

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}

// TanStack Query dedupes by key, so each query has at most one request in flight: an
// interval tick that lands while a fetch is still running joins it instead of starting another.
export const queries = {
  health: () => queryOptions({ queryKey: ["health"], queryFn: () => apiGet(endpoints.health) }),
  session: () => queryOptions({ queryKey: ["auth", "session"], queryFn: () => apiGet(endpoints.auth.session) }),
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
