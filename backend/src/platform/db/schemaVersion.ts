import { errorCode, DatabaseSetupError } from "./errors.js";
import { LATEST_MIGRATION } from "./latestMigration.js";

/** The one method the schema check needs; a pg Pool, a client or a test fake satisfies it. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** node-pg-migrate's bookkeeping table is `pgmigrations` in the public schema (its default). */
const APPLIED_QUERY = "SELECT 1 FROM pgmigrations WHERE name = $1";

/**
 * ADR-0025 decision 6: the backend never migrates itself. At startup it checks that the newest
 * migration bundled in this build has been applied, and says "run npm run db:migrate" if not. A
 * schema AHEAD of the build (a newer migration also applied) is fine: schema changes are additive,
 * so an older build keeps working (the rollback path).
 */
export async function assertSchemaCurrent(db: Queryable, latest: string = LATEST_MIGRATION): Promise<void> {
  let applied: boolean;
  try {
    const result = await db.query(APPLIED_QUERY, [latest]);
    applied = result.rows.length > 0;
  } catch (err) {
    if (errorCode(err) === "42P01") {
      // undefined_table: nothing has been migrated yet.
      throw new DatabaseSetupError("The database has no schema yet: run npm run db:migrate, then start the backend.");
    }
    throw err;
  }
  if (!applied) {
    throw new DatabaseSetupError(
      "The database schema is behind this build (its newest migration has not been applied): run npm run db:migrate, then start the backend.",
    );
  }
}
