import pg from "pg";
import type { DatabaseConfig } from "./config.js";
import { errorCode } from "./errors.js";

/**
 * ADR-0054 D3.2: one leader among the backend instances, so the timer-driven, global workers (alerts, sweepers, the
 * game-server pollers) run once even while a rollout overlaps two tasks.
 *
 * A dedicated `pg` client (not from the pool, whose connections rotate) holds a SESSION advisory lock: Postgres releases
 * it when that connection closes, also when the process dies without a word. Every `intervalMs` (5 s) a follower tries
 * `pg_try_advisory_lock`, and the leader runs `SELECT 1` on the same client. Any failure of that client (a query error,
 * an 'error' event, a dropped connection) ends leadership at once: the leader-only workers stop (no leader is better
 * than two), the client is dropped, and the next tick connects again and retries. `stop()` (shutdown) stops the leader
 * workers first, then unlocks and closes the client, so a follower takes over within one interval.
 *
 * Every step (a tick, a client error, stop) runs one at a time on one queue, so `onAcquired` and `onLost` never overlap
 * and always alternate.
 */

/** The fixed lock key (any bigint, the same in every instance and build). Advisory locks are per database. */
export const LEADER_LOCK_KEY = "5436174953510417";
export const LEADER_LOCK_INTERVAL_MS = 5_000;

const TRY_LOCK = "SELECT pg_try_advisory_lock($1::bigint) AS locked";
const UNLOCK = "SELECT pg_advisory_unlock($1::bigint) AS unlocked";

/** The part of `pg.Client` the lock uses. */
export interface LeaderLockClient {
  connect(): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown>;
  on(event: "error", listener: (err: Error) => void): unknown;
}

export interface LeaderLockLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface LeaderLockOptions {
  /** Creates a new, unconnected client. Called again after every failure. */
  createClient: () => LeaderLockClient;
  logger: LeaderLockLogger;
  /** Starts the leader-only workers. An error is logged, and the instance stays leader. */
  onAcquired: () => Promise<void> | void;
  /** Stops the leader-only workers. Awaited before the lock is released or retried. */
  onLost: () => Promise<void> | void;
  key?: string;
  intervalMs?: number;
}

/** The dedicated client for the lock: the pool's URL and timeouts, keep-alive on so a dead connection is noticed. */
export function createLeaderLockClient(config: DatabaseConfig): LeaderLockClient {
  return new pg.Client({
    connectionString: config.url,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    query_timeout: config.statementTimeoutMs + 1_000,
    keepAlive: true,
    application_name: "satisfactory-dash-leader",
  });
}

export class LeaderLock {
  private readonly key: string;
  private readonly intervalMs: number;
  private client: LeaderLockClient | undefined;
  /** This instance's session holds the lock (it may not be leader yet: a stop can land between the two). */
  private locked = false;
  private leader = false;
  private started = false;
  private stopped = false;
  /** A failure streak is logged once, not every interval. */
  private failing = false;
  /** "Follower" is logged once per state change, not every interval. */
  private followerLogged = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private stopping: Promise<void> | undefined;

  constructor(private readonly options: LeaderLockOptions) {
    this.key = options.key ?? LEADER_LOCK_KEY;
    this.intervalMs = options.intervalMs ?? LEADER_LOCK_INTERVAL_MS;
  }

  isLeader(): boolean {
    return this.leader;
  }

  /** Begins trying for the lock (the first try at once). Idempotent; a stopped lock stays stopped. */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule(0);
  }

  /** Steps down (stops the leader-only workers), releases the lock and closes the client. Idempotent. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.stopping = this.enqueue(async () => {
      if (this.leader) {
        this.leader = false;
        this.options.logger.info({}, "leader stepping down: stopping leader-only workers");
        await this.runCallback("onLost");
      }
      const client = this.client;
      this.client = undefined;
      if (client === undefined) return;
      if (this.locked) {
        this.locked = false;
        try {
          await client.query(UNLOCK, [this.key]);
        } catch {
          // Closing the connection below releases it anyway.
        }
      }
      try {
        await client.end();
      } catch {
        // Already broken: nothing holds the lock.
      }
    });
    return this.stopping;
  }

  private enqueue(step: () => Promise<void>): Promise<void> {
    const next = this.queue.then(step).catch((err: unknown) => {
      this.options.logger.error({ error: err instanceof Error ? err.name : "unknown" }, "leader lock step failed");
    });
    this.queue = next;
    return next;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.enqueue(() => this.tick());
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    let client: LeaderLockClient | undefined;
    try {
      client = await this.connected();
      if (this.stopped) return;
      if (!this.locked) {
        const result = await client.query(TRY_LOCK, [this.key]);
        if (result.rows[0]?.locked === true) {
          this.locked = true;
          if (this.stopped) return; // stop() releases it
          this.leader = true;
          this.followerLogged = false;
          this.recovered();
          this.options.logger.info({}, "this instance is now the leader: starting leader-only workers");
          await this.runCallback("onAcquired");
        } else {
          this.recovered();
          if (!this.followerLogged) {
            this.followerLogged = true;
            this.options.logger.info({}, "another instance holds the leader lock: this instance is a follower");
          }
        }
      } else {
        await client.query("SELECT 1");
        this.recovered();
      }
    } catch (err) {
      // `this.client` too: a connect that failed never returned its client. Steps run one at a time, so it is this tick's.
      const failed = client ?? this.client;
      if (failed !== undefined) await this.lose(failed, err);
    } finally {
      this.schedule(this.intervalMs);
    }
  }

  /** The current client, connecting a new one when there is none. A failed connect drops it (via `lose`). */
  private async connected(): Promise<LeaderLockClient> {
    if (this.client !== undefined) return this.client;
    const client = this.options.createClient();
    // Required: an idle client's connection loss is emitted as an event, and an unhandled 'error' crashes the process.
    client.on("error", (err) => void this.enqueue(() => this.lose(client, err)));
    this.client = client;
    await client.connect();
    return client;
  }

  /** The client failed: drop it, and if this instance was the leader, stop the leader-only workers at once. */
  private async lose(client: LeaderLockClient, err: unknown): Promise<void> {
    if (this.client !== client) return; // an older client's late error
    this.client = undefined;
    this.locked = false;
    this.followerLogged = false;
    void client.end().catch(() => {});
    // The code only: a driver message can quote connection details.
    const code = errorCode(err);
    if (this.leader) {
      this.leader = false;
      this.failing = true;
      this.options.logger.warn({ code }, "lost the leader lock (its database connection failed): stopping leader-only workers, retrying");
      await this.runCallback("onLost");
    } else if (!this.failing) {
      this.failing = true;
      this.options.logger.warn({ code }, "leader lock: database connection failed, retrying every few seconds");
    }
  }

  private recovered(): void {
    if (!this.failing) return;
    this.failing = false;
    this.options.logger.info({}, "leader lock: database connection restored");
  }

  private async runCallback(name: "onAcquired" | "onLost"): Promise<void> {
    try {
      await this.options[name]();
    } catch (err) {
      this.options.logger.error({ callback: name, error: err instanceof Error ? err.name : "unknown" }, "leader transition callback failed");
    }
  }
}
