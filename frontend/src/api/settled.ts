import { useQuery, useQueryClient, type QueryKey, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";

/**
 * A query that has never answered goes back to `pending` (its error cleared) on every refetch: TanStack
 * Query v5's fetch start keeps only data (query-core's `fetchState`). With a poll that meant a view flipped
 * error, pending, error every interval: a skeleton re-shown, a banner gone and back, content remounted.
 * These helpers tell a real first load from a poll of a query that has already settled, and keep the
 * last error on screen while it refetches.
 */

/** Pending and never settled: no data and no error yet. Only this shows a skeleton (#494). */
export function isFirstLoad(query: Pick<UseQueryResult, "isPending" | "errorUpdateCount">): boolean {
  return query.isPending && query.errorUpdateCount === 0;
}

/** Each query's latest error, kept past the refetch that clears it. Filled by the cache (createQueryClient). */
const lastErrors = new WeakMap<object, unknown>();

/** The query cache's error hook: remembers the error until the query's next one. */
export function rememberError(error: unknown, query: object): void {
  lastErrors.set(query, error);
}

export interface Settled<TData> {
  query: UseQueryResult<TData>;
  /** Pending and never settled: the only state that shows a skeleton. */
  firstLoad: boolean;
  /** The error to show: the current one, or, while a failed query refetches, the last one. Null once data is in. */
  error: unknown;
}

/**
 * `useQuery` plus `firstLoad` and a steady `error`. The last error lives with the query in the cache, so a
 * view that mounts mid-refetch (a tab opened while the poll is out) shows it too.
 */
export function useSettledQuery<TData, TKey extends QueryKey>(
  options: UseQueryOptions<TData, Error, TData, TKey>,
): Settled<TData> {
  const client = useQueryClient();
  const query = useQuery(options);
  const firstLoad = isFirstLoad(query);
  let error: unknown = query.error;
  if (error === null && query.isPending && !firstLoad) {
    const cached = client.getQueryCache().find({ queryKey: options.queryKey, exact: true });
    error = cached ? (lastErrors.get(cached) ?? null) : null;
  }
  return { query, firstLoad, error };
}
