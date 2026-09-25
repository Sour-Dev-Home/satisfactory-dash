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
    idleTimeoutMillis: config.idleTimeoutMs ?? 30_000,
    // One connection is never evicted by the idle timeout, so the readiness probe (every few
    // minutes, longer than the idle timeout) finds a warm connection instead of paying a fresh
    // TCP + SCRAM handshake on a busy machine. Not pre-created: the first use opens it.
    min: 1,
    statement_timeout: config.statementTimeoutMs,
    // Client-side backstop: statement_timeout is enforced by the server, so a query on a
    // silently dead socket would otherwise never settle. Slightly longer, so the server's
    // own (clearer) timeout wins when the server is alive.
    query_timeout: config.statementTimeoutMs + 1_000,
    application_name: "satisfactory-dash",
  });
  pool.on("error", (err) => {
    // The code only: the message can quote connection details.
    logger.error({ code: errorCode(err) }, "idle database client error");
  });
  return pool;
}
