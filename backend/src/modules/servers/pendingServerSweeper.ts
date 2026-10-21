import { formatErrorDetail } from "../../platform/formatErrorDetail.js";
import { FailureStreak, failuresForWindow } from "../../platform/failureStreak.js";
import type { createLogger } from "../../platform/logger.js";
import type { Mutex } from "../../platform/mutex.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { withTransaction } from "../../platform/db/transaction.js";
import { createBackgroundRecorder, type MetricsRecorder, type MetricsSink } from "../../platform/metrics/index.js";
import { listPendingSelfServeServers, lockExpiredSelfServeServer, softDeleteServerInTransaction } from "./repositories/serverRepository.js";
import type { ManagementDb } from "./serverManagement.js";

/**
 * ADR-0046 C4 (#526): a self-serve server that has never enrolled within `ttlHours` of its creation is removed, so pending
 * servers cannot hold C1, C2 and C3 slots. Every `intervalMs`, at most `batchSize` of the oldest candidates are taken, and each
 * is removed in its own transaction: its row is LOCKED first (an enrolment in flight finishes or waits), then the agents
 * module is asked whether it has ever enrolled (a credential row, revoked or not: a server that ever enrolled is never swept),
 * and only then does `softDeleteServer`'s purge run, with `server.deleted` and `detail: { reason: "never_enrolled" }`, ids
 * only. Operator-created servers are never candidates. After the commit the runtime entry goes.
 *
 * Idempotent: a server already removed (by its owner, the operator or another instance's sweep) no longer qualifies and is
 * skipped. One run at a time (the next is scheduled when one ends). A failed run is logged once per run of failures and tried
 * again; it never throws. The log line and the metric carry counts only, never an id or a name.
 */
export const PENDING_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
export const PENDING_SWEEP_BATCH = 50;
const SWEPT_METRIC = "satis.servers.pending_swept";

/** The platform logger's type (rule 4: `servers` imports platform/, never pino itself). */
type Logger = ReturnType<typeof createLogger>;

export interface PendingServerSweeperDeps {
  db: ManagementDb;
  logger: Logger;
  /** C4, hours (`SELF_SERVE_PENDING_TTL_HOURS`). */
  ttlHours: number;
  /** Has this server ever enrolled? The agents module's function, supplied by the composition root (as for C3). */
  enrolledServerIds: (db: Queryable, serverIds: readonly string[]) => Promise<ReadonlySet<string>>;
  /** Drops a removed server's runtime entry after the commit. */
  removeRuntime: (publicId: string) => Promise<unknown>;
  /** Where the counter goes; the process-wide background aggregator by default (tests pass their own). */
  metrics?: MetricsSink;
  intervalMs?: number;
  batchSize?: number;
  /** The management service's mutex (the composition root's shared instance). */
  mutex?: Mutex;
}

export interface PendingSweepResult {
  swept: number;
  /** Candidates that no longer qualified under the lock (enrolled meanwhile, or already removed). */
  skipped: number;
}

export class PendingServerSweeper {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private readonly streak: FailureStreak;
  private readonly metrics: MetricsRecorder;

  constructor(private readonly deps: PendingServerSweeperDeps) {
    this.metrics = createBackgroundRecorder(deps.logger, deps.metrics);
    // #560: the floor of 2 failed sweeps (20 minutes at the default 10 min): one sweep is already past five minutes.
    this.streak = new FailureStreak({
      logger: deps.logger,
      job: "pending-server-sweeper",
      escalateAfter: failuresForWindow(deps.intervalMs ?? PENDING_SWEEP_INTERVAL_MS),
      failedMsg: "sweeping pending self-serve servers failed; trying again",
      recoveredMsg: "pending self-serve server sweep recovered",
      countField: "failedSweeps",
    });
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.run();
    }, this.deps.intervalMs ?? PENDING_SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Removes one candidate if it still qualifies under its row lock. */
  private sweepOne(publicId: string): Promise<boolean> {
    // #526 (L1): under the management mutex like every other server write followed by a runtime change.
    return this.deps.mutex ? this.deps.mutex.run(() => this.removeOne(publicId)) : this.removeOne(publicId);
  }

  private async removeOne(publicId: string): Promise<boolean> {
    const { db, ttlHours, enrolledServerIds } = this.deps;
    const removed = await withTransaction(db, async (client) => {
      const serverId = await lockExpiredSelfServeServer(client, publicId, ttlHours);
      if (serverId === undefined) return false;
      if ((await enrolledServerIds(client, [serverId])).has(serverId)) return false;
      return softDeleteServerInTransaction(client, publicId, { actorUserId: null, detail: { reason: "never_enrolled" } });
    });
    if (removed) {
      // The row is already gone (the database is the truth), so a runtime that fails to stop is reported and the batch goes on:
      // throwing here would drop this server from the count and leave the rest of the batch to the next run.
      try {
        await this.deps.removeRuntime(publicId);
      } catch (err) {
        this.deps.logger.warn({ err: formatErrorDetail(err) }, "a swept self-serve server's runtime entry could not be removed");
      }
    }
    return removed;
  }

  /** One sweep; exposed for tests. Never throws (a failure is logged and the result is what got done before it). */
  async sweep(): Promise<PendingSweepResult> {
    const result: PendingSweepResult = { swept: 0, skipped: 0 };
    try {
      const candidates = await listPendingSelfServeServers(this.deps.db, this.deps.ttlHours, this.deps.batchSize ?? PENDING_SWEEP_BATCH);
      for (const publicId of candidates) {
        if (this.stopped) break;
        if (await this.sweepOne(publicId)) result.swept++;
        else result.skipped++;
      }
      this.streak.success();
    } catch (err) {
      this.streak.failure({ err: formatErrorDetail(err) });
    }
    if (result.swept > 0) {
      this.metrics.counter(SWEPT_METRIC, {}, result.swept);
      this.deps.logger.info(result, "removed self-serve servers that never enrolled");
    }
    return result;
  }

  private async run(): Promise<void> {
    try {
      await this.sweep();
    } finally {
      this.inFlight = undefined;
      this.schedule();
    }
  }
}

export function createPendingServerSweeper(deps: PendingServerSweeperDeps): PendingServerSweeper {
  return new PendingServerSweeper(deps);
}
