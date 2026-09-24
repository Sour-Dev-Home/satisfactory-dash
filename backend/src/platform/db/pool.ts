import pg from "pg";
import type { DatabaseConfig } from "./config.js";
import { errorCode } from "./errors.js";

export interface PoolLogger {
  error(obj: object, msg: string): void;
}

/**
 * The one pool (ADR-0025 decision 2). It connects on demand and reconnects after an outage, so
 * the backend never needs to exit on a database error at runtime. The 'error' listener is
 * required: an idle client's connection loss is emitted as an event, and an unhandled 'error'
 * event would crash the process.
 */
export function createDbPool(config: DatabaseConfig, logger: PoolLogger): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.url,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: 30_000,
    statement_timeout: config.statementTimeoutMs,
    application_name: "satisfactory-dash",
  });
  pool.on("error", (err) => {
    // The code only: the message can quote connection details.
    logger.error({ code: errorCode(err) }, "idle database client error");
  });
  return pool;
}
