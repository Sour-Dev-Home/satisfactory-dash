import type { Pool } from "pg";
import type { DatabaseConfig } from "./config.js";
import { connectWithBackoff } from "./startup.js";
import type { BackoffOptions, StartupLogger } from "./startup.js";
import { createDbPool } from "./pool.js";
import type { PoolLogger } from "./pool.js";
import { assertSchemaCurrent } from "./schemaVersion.js";

export interface DatabaseLogger extends StartupLogger, PoolLogger {
  info(obj: object, msg: string): void;
}

/** How long the readiness probe waits for SELECT 1 (ADR-0025 decision 6). */
export const READINESS_TIMEOUT_MS = 1_000;

/**
 * The backend's database handle: the pool plus its startup and readiness behaviour.
 * `start()` runs the transient-retry startup (a refused connection, 57P03) and then the schema
 * check; it rejects with a DatabaseSetupError the composition root turns into exit 1.
 */
export class Database {
  readonly pool: Pool;
  private started = false;

  constructor(
    config: DatabaseConfig,
    private readonly logger: DatabaseLogger,
    private readonly backoff: Omit<BackoffOptions, "logger"> = {},
    pool: Pool = createDbPool(config, logger),
  ) {
    this.pool = pool;
  }

  async start(): Promise<void> {
    await connectWithBackoff(async () => {
      await this.pool.query("SELECT 1");
      await assertSchemaCurrent(this.pool);
    }, { ...this.backoff, logger: this.logger });
    this.started = true;
    this.logger.info({}, "database connected and schema current");
  }

  /** True once startup finished AND a SELECT 1 answers within the readiness timeout. The
   *  answer never says why not: the readiness endpoint is public. */
  async isReady(): Promise<boolean> {
    if (!this.started) {
      return false;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("readiness timeout")), READINESS_TIMEOUT_MS);
      });
      await Promise.race([this.pool.query("SELECT 1"), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
