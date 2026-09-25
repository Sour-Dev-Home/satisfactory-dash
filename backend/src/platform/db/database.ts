import type { Pool, PoolClient } from "pg";
import { DEFAULT_READINESS_TIMEOUT_MS } from "./config.js";
import type { DatabaseConfig } from "./config.js";
import { errorCode } from "./errors.js";
import { connectWithBackoff } from "./startup.js";
import type { BackoffOptions, StartupLogger } from "./startup.js";
import { createDbPool } from "./pool.js";
import type { PoolLogger } from "./pool.js";
import { assertSchemaCurrent } from "./schemaVersion.js";

export interface DatabaseLogger extends StartupLogger, PoolLogger {
  info(obj: object, msg: string): void;
}

type ReadinessPhase = "acquire" | "query";

class ReadinessTimeout extends Error {
  constructor() {
    super("readiness timeout");
    this.name = "ReadinessTimeout";
  }
}

/** The default budget for the readiness probe (ADR-0025 decision 6); DATABASE_READINESS_TIMEOUT_MS overrides it. */
export const READINESS_TIMEOUT_MS = DEFAULT_READINESS_TIMEOUT_MS;

/**
 * The backend's database handle: the pool plus its startup and readiness behaviour.
 * `start()` runs the transient-retry startup (a refused connection, 57P03) and then the schema
 * check; it rejects with a DatabaseSetupError the composition root turns into exit 1.
 */
export class Database {
  readonly pool: Pool;
  private readonly readinessTimeoutMs: number;
  private started = false;
  private closed = false;

  constructor(
    config: DatabaseConfig,
    private readonly logger: DatabaseLogger,
    private readonly backoff: Omit<BackoffOptions, "logger"> = {},
    pool: Pool = createDbPool(config, logger),
  ) {
    this.pool = pool;
    this.readinessTimeoutMs = config.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  }

  async start(): Promise<void> {
    try {
      await connectWithBackoff(async () => {
        if (this.closed) {
          throw new Error("closed during startup");
        }
        await this.pool.query("SELECT 1");
        await assertSchemaCurrent(this.pool);
      }, { ...this.backoff, logger: this.logger });
    } catch (err) {
      // A shutdown that arrives while startup is retrying ends startup quietly: the pool was
      // closed on purpose, so the next attempt's failure is not a startup failure (it would
      // otherwise become exit 1 and race the graceful exit 0).
      if (this.closed) {
        return;
      }
      throw err;
    }
    if (this.closed) {
      return; // closed while the last attempt was succeeding: not started, and nothing to announce
    }
    this.started = true;
    this.logger.info({}, "database connected and schema current");
  }

  /** True once startup finished AND a SELECT 1 answers within the readiness timeout. The
   *  answer never says why not: the readiness endpoint is public. */
  async isReady(): Promise<boolean> {
    if (!this.started) {
      return false;
    }
    const budgetMs = this.readinessTimeoutMs;
    const startedAt = performance.now();
    // The two phases are timed apart so a miss says WHICH one was slow: getting a connection from
    // the pool (a fresh handshake, or a busy pool) or the SELECT 1 itself.
    let phase: ReadinessPhase = "acquire";
    let client: PoolClient | undefined;
    let timer: NodeJS.Timeout | undefined;
    const probe = (async () => {
      client = await this.pool.connect();
      phase = "query";
      await client.query("SELECT 1");
    })();
    // The connection goes back whenever the probe settles, even after we gave up on it: a probe
    // that finishes late must not leak a pool slot. A failed probe destroys its connection.
    void probe.then(
      () => client?.release(),
      (err: unknown) => client?.release(err instanceof Error ? err : true),
    );
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReadinessTimeout()), budgetMs);
      });
      await Promise.race([probe, timeout]);
      return true;
    } catch (err) {
      // ONE warn with a fixed code and numbers only: never the error's message (it can quote
      // connection details), and never anything in the public response body.
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (err instanceof ReadinessTimeout) {
        this.logger.warn({ code: "readiness_probe_slow", elapsed_ms: elapsedMs, phase, budget_ms: budgetMs }, "readiness probe timed out");
      } else {
        this.logger.warn(
          { code: "readiness_probe_failed", elapsed_ms: elapsedMs, phase, db_code: errorCode(err) },
          "readiness probe failed",
        );
      }
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.started = false;
    await this.pool.end();
  }
}
