import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { isDeployGapError } from "./errors";

// ADR-0054 D4: while the backend is being replaced, Cloudflare (or the network) answers with something that is not
// the API's own error envelope. The dashboard says "updating, back in a moment", keeps the last data (the query
// cache does), and retries with backoff until the backend answers. After a long gap it stops promising a quick
// return and the usual "couldn't reach the backend" wording takes over.

/** The first wait before retrying the reads that hit the gap; each retry doubles it, up to the cap (5, 10, 20, 30, 30 s). */
export const DEPLOY_GAP_RETRY_BASE_MS = 5_000;
export const DEPLOY_GAP_RETRY_CAP_MS = 30_000;

/** How long a gap still counts as a deploy. Past this it reads as a real outage. */
export const DEPLOY_GAP_GIVE_UP_MS = 180_000;

/** "updating": a deploy gap, recent. "down": the same failure, lasting. "none": the backend answered. */
export type DeployGapPhase = "none" | "updating" | "down";

export interface DeployGap {
  getPhase(): DeployGapPhase;
  subscribe(listener: () => void): () => void;
  /** A query failed; call from the query cache's onError. */
  onQueryError(error: unknown): void;
  /** A query answered (data, or the API's own error); call from the cache's onSuccess. */
  onQueryAnswered(): void;
}

const gaps = new WeakMap<QueryClient, DeployGap>();

/** The client's deploy-gap tracker, made on first use. */
export function deployGapFor(client: QueryClient): DeployGap {
  let gap = gaps.get(client);
  if (!gap) {
    gap = createDeployGap(client);
    gaps.set(client, gap);
  }
  return gap;
}

/** An active read currently failed with a deploy-gap error. */
const gapFailed = (query: { state: { status: string; error: unknown }; getObserversCount(): number }) =>
  query.getObserversCount() > 0 && query.state.status === "error" && isDeployGapError(query.state.error);

function createDeployGap(client: QueryClient): DeployGap {
  let phase: DeployGapPhase = "none";
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const setPhase = (next: DeployGapPhase) => {
    if (next === phase) return;
    phase = next;
    listeners.forEach((listener) => listener());
  };

  const stillFailing = () => client.getQueryCache().findAll({ predicate: gapFailed }).length > 0;

  const clear = () => {
    clearTimeout(retryTimer);
    clearTimeout(giveUpTimer);
    retryTimer = undefined;
    giveUpTimer = undefined;
    attempt = 0;
    setPhase("none");
  };

  const scheduleRetry = () => {
    if (retryTimer !== undefined) return;
    const wait = Math.min(DEPLOY_GAP_RETRY_BASE_MS * 2 ** attempt, DEPLOY_GAP_RETRY_CAP_MS);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (!stillFailing()) {
        clear();
        return;
      }
      // A refetch that fails again lands in onQueryError, which schedules the next, longer wait.
      void client.refetchQueries({ type: "active", predicate: gapFailed });
    }, wait);
  };

  const onQueryAnswered = () => {
    // Other reads may still be failing the same way: the gap is over only when none is.
    if (phase !== "none" && !stillFailing()) clear();
  };

  return {
    getPhase: () => phase,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onQueryError(error) {
      if (!isDeployGapError(error)) {
        onQueryAnswered();
        return;
      }
      if (phase === "none") {
        setPhase("updating");
        giveUpTimer = setTimeout(() => setPhase("down"), DEPLOY_GAP_GIVE_UP_MS);
      }
      scheduleRetry();
    },
    onQueryAnswered,
  };
}

/** The current phase, for the banner. Re-renders when it changes (including the move to "down"). */
export function useDeployGapPhase(): DeployGapPhase {
  const gap = deployGapFor(useQueryClient());
  return useSyncExternalStore(gap.subscribe, gap.getPhase);
}
