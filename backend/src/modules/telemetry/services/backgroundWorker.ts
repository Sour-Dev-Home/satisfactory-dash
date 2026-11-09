/**
 * The worker shapes the telemetry services share. They used to sit in the polled `powerHistoryPoller.ts`; ADR-0066
 * PR 3 moved them here so the agent path (the history recorder, the latest-snapshot writer, the power history read
 * side) no longer imports the poller.
 */

/** A long-running task the composition root starts once the server is listening and stops
 *  on shutdown (ADR-0022: the backend's first background worker). */
export interface BackgroundWorker {
  start(): void;
  /** Stops scheduling and resolves once any poll in flight has finished. */
  stop(): Promise<void>;
}

/** What the read side needs to decide `stale` (ADR-0022: last success older than 3 intervals). */
export interface PollerHealth {
  startedAt(): number | undefined;
  lastSuccessAt(): number | undefined;
}
