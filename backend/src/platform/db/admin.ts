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
 * read the migrations table, and nobody else may use the public schema. An existing database
 * with another owner (RDS creates `db_name` owned by the master user) is handed to the migrator.
 * Works with a superuser admin and with a non-superuser CREATEROLE CREATEDB one (RDS).
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
    await withMigratorSet(admin, async () => {
      const name = admin.escapeIdentifier(options.database);
      const database = await admin.query(
        "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1",
        [options.database],
      );
      if (database.rows.length === 0) {
        await admin.query(
          `CREATE DATABASE ${name} OWNER ${MIGRATOR_ROLE} TEMPLATE template0 ` +
            "ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'",
        );
      } else if (database.rows[0].owner !== MIGRATOR_ROLE) {
        // RDS creates `db_name` itself, owned by the master user. The public schema is owned by
        // pg_database_owner, so it follows the database to the migrator.
        await admin.query(`ALTER DATABASE ${name} OWNER TO ${MIGRATOR_ROLE}`);
      }
      // As the owner, from here: once PUBLIC loses CONNECT, an admin that is neither the owner nor a
      // superuser could not connect to the database at all (on a re-run either), so it keeps CONNECT
      // for itself. A privilege on this database only, not a role membership.
      await admin.query(`SET ROLE ${MIGRATOR_ROLE}`);
      await admin.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
      for (const role of ["SESSION_USER", APP_ROLE, ...(options.backupPassword === undefined ? [] : [BACKUP_ROLE])]) {
        await admin.query(`GRANT CONNECT ON DATABASE ${name} TO ${role}`);
      }
      await admin.query("RESET ROLE");
      await withClient(urlForDatabase(options.adminUrl, options.database), grantInSchema);
    });
  });
}

/**
 * Runs fn while the admin may SET ROLE to the migrator. A superuser, or an admin that already
 * holds SET on it, needs nothing. A non-superuser CREATEROLE admin (RDS) holds the roles it created
 * with ADMIN TRUE, INHERIT FALSE, SET FALSE (PostgreSQL 16+), so it can neither make the migrator a
 * database owner nor act as it: it grants itself SET (never INHERIT) for these steps only and revokes
 * the grant afterwards, also when a step fails, so it keeps no lasting membership.
 */
async function withMigratorSet<T>(admin: pg.Client, fn: () => Promise<T>): Promise<T> {
  const held = await admin.query("SELECT pg_has_role(session_user, $1, 'SET') AS held", [MIGRATOR_ROLE]);
  if (held.rows[0].held === true) {
    return fn();
  }
  await admin.query(`GRANT ${MIGRATOR_ROLE} TO SESSION_USER WITH INHERIT FALSE, SET TRUE`);
  let failure: unknown = null;
  try {
    return await fn();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      // A step may have failed under SET ROLE: revoke as the admin itself, from the admin itself.
      await admin.query("RESET ROLE");
      await admin.query(`REVOKE ${MIGRATOR_ROLE} FROM SESSION_USER`);
    } catch (revokeError) {
      // Never let a lingering grant go unnoticed, but keep the step's own error when there was one.
      const message = `db:init could not revoke its temporary grant: run REVOKE ${MIGRATOR_ROLE} FROM <the admin role> by hand.`;
      // eslint-disable-next-line no-unsafe-finally
      throw failure === null ? new Error(message, { cause: revokeError }) : new AggregateError([failure, revokeError], message);
    }
  }
}

/** The public-schema baseline, run as the migrator (the database owner, and so the owner of public). */
async function grantInSchema(db: pg.Client): Promise<void> {
  await db.query(`SET ROLE ${MIGRATOR_ROLE}`);
  await db.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await db.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  // node-pg-migrate's bookkeeping table is created by the migrator; the app reads it for the
  // startup schema check and nothing else in public.
  await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${APP_ROLE}`);
  // Also cover a bookkeeping table that already exists (re-running db:init after the first
  // migration): default privileges only apply to tables created later.
  await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
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
