import type { Cadence, SnapshotRequest, SnapshotResponse } from "@satisfactory-dash/shared";
import { backoffDelayMs } from "./backoff.js";
import { BackendError } from "./backendClient.js";
import type { AgentLogger } from "./logger.js";
import type { BoundedQueue } from "./queue.js";

/** Waits `ms`, or until `signal` aborts (then it resolves early: the caller checks the signal). */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const abortableSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

export interface PusherOptions {
  client: { postSnapshot(snapshot: SnapshotRequest, signal?: AbortSignal): Promise<SnapshotResponse> };
  queue: BoundedQueue<SnapshotRequest>;
  logger: AgentLogger;
  /** Called with the cadence in every answer: the backend decides how often the agent samples. */
  onCadence: (cadence: Cadence) => void;
  /** Called when an answer says a command is waiting: the command loop polls at once. */
  onCommandsPending: () => void;
  /** Called once when the backend rejects the credential (401): the agent stops and tells the owner to re-enrol. */
  onAuthRejected: () => void;
  sleep?: Sleep;
  random?: () => number;
}

/**
 * Sends the queued snapshots to the backend, oldest first (ADR-0031 PR 6). Its rules (architect):
 *  - a BOUNDED queue that drops the oldest when full, so a long outage cannot grow memory (the caller owns the queue);
 *  - a transient failure (network, timeout, 5xx, 429) keeps the snapshot at the head and retries with exponential backoff and
 *    jitter, honouring `Retry-After`; the loop never gives up on the network;
 *  - a 401 STOPS the loop and calls `onAuthRejected`: retrying a revoked credential forever would only hammer the backend;
 *  - any other 4xx means THIS snapshot can never be accepted (the backend refused its shape or size), so it is dropped and the
 *    next one goes;
 *  - logs are streak-based (first failure, recovery with counts), never one line per attempt, and carry codes only.
 */
export class Pusher {
  private wake: (() => void) | undefined;
  private failures = 0;
  private droppedInStreak = 0;
  private rejected = 0;

  constructor(private readonly options: PusherOptions) {}

  /** Adds a snapshot and wakes the loop. Drops the oldest when the queue is full. */
  enqueue(snapshot: SnapshotRequest): void {
    const dropped = this.options.queue.push(snapshot);
    if (dropped > 0) {
      if (this.droppedInStreak === 0) this.options.logger.warn("queue_full_dropping_oldest", { queued: this.options.queue.size });
      this.droppedInStreak += dropped;
    }
    this.wake?.();
  }

  async run(signal: AbortSignal): Promise<void> {
    const sleep = this.options.sleep ?? abortableSleep;
    const { queue, client, logger } = this.options;
    while (!signal.aborted) {
      const head = queue.peek();
      if (head === undefined) {
        await new Promise<void>((resolve) => {
          const done = () => {
            this.wake = undefined;
            signal.removeEventListener("abort", done);
            resolve();
          };
          this.wake = done;
          signal.addEventListener("abort", done, { once: true });
          if (queue.size > 0 || signal.aborted) done();
        });
        continue;
      }
      try {
        const answer = await client.postSnapshot(head, signal); // the stop signal cancels a request in flight
        if (queue.peek() === head) queue.shift(); // the head may have been dropped for room while this was in flight
        if (this.failures > 0) {
          logger.info("push_recovered", { attempts: this.failures, queued: queue.size, dropped: this.droppedInStreak });
          this.failures = 0;
          this.droppedInStreak = 0;
        }
        this.options.onCadence(answer.cadence);
        if (answer.commandsPending) this.options.onCommandsPending();
      } catch (err) {
        if (signal.aborted) return;
        if (!(err instanceof BackendError)) {
          // Not from the client (a bug): treat as transient, code only, so the agent keeps running.
          await this.retryLater(sleep, signal, "internal_error", undefined, undefined);
          continue;
        }
        if (err.kind === "auth_rejected") {
          logger.error("auth_rejected", { status: err.status });
          this.options.onAuthRejected();
          return;
        }
        if (err.kind === "fatal") {
          if (queue.peek() === head) queue.shift();
          this.rejected += 1;
          if (this.rejected === 1 || this.rejected % 100 === 0) logger.warn("snapshot_refused", { status: err.status, code: err.code, refused: this.rejected });
          continue;
        }
        await this.retryLater(sleep, signal, err.code ?? "unreachable_or_5xx", err.status, err.retryAfterMs);
      }
    }
  }

  private async retryLater(sleep: Sleep, signal: AbortSignal, code: string, status: number | undefined, retryAfterMs: number | undefined): Promise<void> {
    if (this.failures === 0) this.options.logger.warn("push_failed", { code, status, queued: this.options.queue.size });
    const delay = Math.max(retryAfterMs ?? 0, backoffDelayMs(this.failures, { random: this.options.random }));
    this.failures += 1;
    await sleep(delay, signal);
  }
}
