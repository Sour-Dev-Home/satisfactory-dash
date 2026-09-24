import type { PowerHistory } from "@satisfactory-dash/shared";
import type { PowerHistoryStore } from "./powerHistoryStore.js";
import { POWER_HISTORY_INTERVAL_SECONDS } from "./powerHistoryStore.js";
import type { PollerHealth } from "./powerHistoryPoller.js";

/** ADR-0022: the history is stale when the poller's last success is older than this many intervals. */
export const STALE_AFTER_INTERVALS = 3;

export interface PowerHistoryResult {
  data: PowerHistory;
  /** ISO time of the poller's last successful read (now, if it has never succeeded). */
  observedAt: string;
  stale: boolean;
}

/**
 * What the power history route serves: the store's window plus the ADR-0004 envelope
 * fields, decided here (not by the client) from the poller's health. It never calls the
 * game server: a request costs a read of memory, however many people are watching.
 */
export class PowerHistoryService {
  private readonly staleAfterMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: PowerHistoryStore,
    private readonly health: PollerHealth,
    options: { intervalSeconds?: number; now?: () => number } = {},
  ) {
    this.staleAfterMs = STALE_AFTER_INTERVALS * (options.intervalSeconds ?? POWER_HISTORY_INTERVAL_SECONDS) * 1000;
    this.now = options.now ?? Date.now;
  }

  getPowerHistory(): PowerHistoryResult {
    const nowMs = this.now();
    const lastSuccess = this.health.lastSuccessAt();
    // Before the first success, measure from when polling started; if it never started
    // (nothing is sampling), the data can't be fresh.
    const reference = lastSuccess ?? this.health.startedAt();
    const stale = reference === undefined || nowMs - reference > this.staleAfterMs;
    return {
      data: this.store.window(nowMs),
      observedAt: new Date(lastSuccess ?? nowMs).toISOString(),
      stale,
    };
  }
}
