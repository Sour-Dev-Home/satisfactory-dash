import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runner } from "node-pg-migrate";

/**
 * Operator and test tooling for ADR-0025: create the roles and the database, and apply the
 * migrations. It is used by `npm run db:init`, `npm run db:migrate` and the Testcontainers
 * harness, never by the running backend (which holds only the satis_app credentials and never
 * migrates itself), so it is not part of the bundled server.
 */
export const MIGRATOR_ROLE = "satis_migrator";
export const APP_ROLE = "satis_app";
/** Backups only (ADR-0025 decision 7): reads everything, changes nothing, and is never used by the
 *  running backend or the migrations, so a backup never borrows either one's credentials. */
export const BACKUP_ROLE = "satis_backup";

export interface ProvisionOptions {
  /** Superuser (or CREATEROLE + CREATEDB) connection to any database, normally "postgres". */
  adminUrl: string;
  database: string;
  migratorPassword: string;
  appPassword: string;
  /** Optional: when set, the read-only backup role is created (or its password reset). Left out,
   *  no backup role is touched, so an existing deployment's db:init is unchanged. */
  backupPassword?: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  // A dropped connection (e.g. the server restarting) is emitted as an 'error' event; without a
  // listener it would crash the script instead of failing the pending query cleanly.
  client.on("error", () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function urlForDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Idempotent. Creates the two roles (passwords set or reset), the database owned by the
 * migrator with the builtin C.UTF-8 locale (the same in every environment, so sorting doesn't
 * differ between Windows and Linux), and the baseline grants: the app role may connect and
 * read the migrations table, and nobody else may use the public schema.
 */
export async function provisionDatabase(options: ProvisionOptions): Promise<void> {
  if (!IDENTIFIER.test(options.database)) {
    throw new Error("The database name must be lowercase letters, digits and underscores.");
  }
  await withClient(options.adminUrl, async (admin) => {
    const roles: [string, string][] = [
      [MIGRATOR_ROLE, options.migratorPassword],
      [APP_ROLE, options.appPassword],
    ];
    if (options.backupPassword !== undefined) {
      roles.push([BACKUP_ROLE, options.backupPassword]);
    }
    for (const [role, password] of roles) {
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      const verb = exists.rows.length > 0 ? "ALTER" : "CREATE";
      await admin.query(`${verb} ROLE ${role} LOGIN PASSWORD ${admin.escapeLiteral(password)}`);
    }
    if (options.backupPassword !== undefined) {
      // pg_read_all_data (PostgreSQL 14+) is SELECT on every table, view and sequence plus USAGE on
      // every schema, including ones created later: a dump is complete by construction. Read-only by
      // default as well, so even a mistaken statement on this role cannot write.
      await admin.query(`GRANT pg_read_all_data TO ${BACKUP_ROLE}`);
      await admin.query(`ALTER ROLE ${BACKUP_ROLE} SET default_transaction_read_only = on`);
    }
    const database = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [options.database]);
    if (database.rows.length === 0) {
      await admin.query(
        `CREATE DATABASE ${admin.escapeIdentifier(options.database)} OWNER ${MIGRATOR_ROLE} TEMPLATE template0 ` +
          "ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'",
      );
    }
  });
  await withClient(urlForDatabase(options.adminUrl, options.database), async (db) => {
    const name = db.escapeIdentifier(options.database);
    await db.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
    await db.query(`GRANT CONNECT ON DATABASE ${name} TO ${APP_ROLE}`);
    if (options.backupPassword !== undefined) {
      await db.query(`GRANT CONNECT ON DATABASE ${name} TO ${BACKUP_ROLE}`);
    }
    await db.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await db.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    // node-pg-migrate's bookkeeping table is created by the migrator; the app reads it for the
    // startup schema check and nothing else in public.
    await db.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public GRANT SELECT ON TABLES TO ${APP_ROLE}`,
    );
    // Also cover a bookkeeping table that already exists (re-running db:init after the first
    // migration): default privileges only apply to tables created later.
    await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
  });
}

/** backend/migrations, resolved from this file so it works from src and from the repo root. */
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations");

/** Applies every pending migration as the migrator. Forward-only ("up"). */
export async function migrateUp(migratorUrl: string, log: (message: string) => void = () => {}): Promise<void> {
  await runner({
    databaseUrl: migratorUrl,
    dir: MIGRATIONS_DIR,
    direction: "up",
    migrationsTable: "pgmigrations",
    count: Infinity,
    log,
  });
}
