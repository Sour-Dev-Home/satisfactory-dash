import { z } from "zod";
import type { Queryable } from "./db/schemaVersion.js";
import { timedQuery } from "./db/timedQuery.js";

/**
 * Retention sweeps for tables that had no cleanup of their own (privacy policy, "How long we keep it"). They
 * run from the hourly purge worker (identity/sessionPurge.ts) in small ctid batches, like the session purge:
 * expired agent enrollment codes, passed alert mutes, and delivered or dead alert outbox rows after 7 days.
 * Pending outbox rows and live codes/mutes are never touched.
 */
export const OUTBOX_RETENTION_DAYS = 7;
const BATCH_SIZE = 1000;
const MAX_BATCHES_PER_SWEEP = 100;

const DeletedSchema = z.object({ deleted: z.coerce.number() });

const DELETE_EXPIRED_CODES = `
  WITH d AS (
    DELETE FROM agents.enrollment_codes
    WHERE ctid IN (SELECT ctid FROM agents.enrollment_codes WHERE expires_at < now() LIMIT $1)
    RETURNING 1)
  SELECT count(*)::int AS deleted FROM d`;
const DELETE_PASSED_MUTES = `
  WITH d AS (
    DELETE FROM alerts.server_mutes
    WHERE ctid IN (SELECT ctid FROM alerts.server_mutes WHERE muted_until < now() LIMIT $1)
    RETURNING 1)
  SELECT count(*)::int AS deleted FROM d`;
const DELETE_FINISHED_OUTBOX = `
  WITH d AS (
    DELETE FROM alerts.outbox
    WHERE ctid IN (
      SELECT ctid FROM alerts.outbox
      WHERE status IN ('sent', 'dead') AND COALESCE(sent_at, created_at) < now() - ($2::int * interval '1 day')
      LIMIT $1)
    RETURNING 1)
  SELECT count(*)::int AS deleted FROM d`;

async function drain(run: (batchSize: number) => Promise<{ rows: unknown[] }>): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
    const result = await run(BATCH_SIZE);
    const parsed = DeletedSchema.safeParse(result.rows[0]);
    const deleted = parsed.success ? parsed.data.deleted : 0;
    total += deleted;
    if (deleted < BATCH_SIZE) break;
  }
  return total;
}

export interface RetentionSweepResult {
  enrollmentCodes: number;
  serverMutes: number;
  outbox: number;
}

/** One sweep of all three tables. Exposed for tests. */
export async function sweepRetention(db: Queryable): Promise<RetentionSweepResult> {
  return {
    enrollmentCodes: await drain((n) => timedQuery(db, "retention.expiredEnrollmentCodes", DELETE_EXPIRED_CODES, [n])),
    serverMutes: await drain((n) => timedQuery(db, "retention.passedMutes", DELETE_PASSED_MUTES, [n])),
    outbox: await drain((n) => timedQuery(db, "retention.finishedOutbox", DELETE_FINISHED_OUTBOX, [n, OUTBOX_RETENTION_DAYS])),
  };
}

const TableSizeSchema = z.object({ table_name: z.string(), mb: z.coerce.number() });
const TOP_TABLE_SIZES = `
  SELECT n.nspname || '.' || c.relname AS table_name,
         round(pg_total_relation_size(c.oid) / 1048576.0, 1)::float8 AS mb
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  ORDER BY pg_total_relation_size(c.oid) DESC
  LIMIT 5`;

/** The five largest tables (data plus indexes) in MB, for the once-a-day size line. Empty when none are visible. */
export async function topTableSizes(db: Queryable): Promise<{ table: string; mb: number }[]> {
  const result = await timedQuery(db, "retention.topTableSizes", TOP_TABLE_SIZES, []);
  const sizes: { table: string; mb: number }[] = [];
  for (const row of result.rows) {
    const parsed = TableSizeSchema.safeParse(row);
    if (parsed.success) sizes.push({ table: parsed.data.table_name, mb: parsed.data.mb });
  }
  return sizes;
}
