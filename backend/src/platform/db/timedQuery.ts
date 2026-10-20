import type { Pool, PoolClient, QueryResult } from "pg";
import { createLogger } from "../logger.js";
import { createBackgroundRecorder, type MetricsRecorder } from "../metrics/backgroundMetrics.js";
import type { QueryName } from "../metrics/registry.js";
import type { Queryable } from "./schemaVersion.js";

/** ADR-0037 §1: the database round-trip histogram every query is timed into. */
export const DB_QUERY_METRIC = "db.client.operation.duration";

let recorder: MetricsRecorder | undefined;

/** Built on first use, so importing a repository never builds a logger. The recorder never throws
 *  and logs a refused recording once; with `QueryName` a closed union there should be none. */
function metrics(): MetricsRecorder {
  recorder ??= createBackgroundRecorder(createLogger());
  return recorder;
}

/**
 * ADR-0037 build step 4: every query goes through here, so each one is timed into
 * `db.client.operation.duration`, labelled `query` = its static name and nothing else. The SQL,
 * the params and the result are never a label and never logged. The result and any error are the
 * query's own, unchanged; the duration is recorded either way, before the result is returned or
 * the error rethrown. It runs on whatever it's given (a pool, or a transaction's client), so
 * transaction behaviour is the caller's, as before.
 */
export function timedQuery(db: Pick<Pool | PoolClient, "query">, name: QueryName, sql: string, params?: unknown[]): Promise<QueryResult>;
/** The repositories' own `Queryable` (every pool and client is one): the same, with its result type. */
export function timedQuery(db: Queryable, name: QueryName, sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
export async function timedQuery(db: Queryable, name: QueryName, sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
  const start = performance.now();
  try {
    // No params is passed as no argument, exactly as the call sites did before.
    return params === undefined ? await db.query(sql) : await db.query(sql, params);
  } finally {
    metrics().histogram(DB_QUERY_METRIC, { query: name }, performance.now() - start);
  }
}
