import { randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { APP_PASSWORD, BACKUP_PASSWORD, MIGRATOR_PASSWORD, TEMPLATE_DATABASE } from "./dbGlobalSetup.js";

export interface TestDatabase {
  name: string;
  /** Superuser, for tests that need to break or inspect things. */
  adminUrl: string;
  /** The runtime role (satis_app): DML only. */
  appUrl: string;
  /** The migration role (satis_migrator). */
  migratorUrl: string;
  /** The read-only backup role (satis_backup). */
  backupUrl: string;
  drop(): Promise<void>;
}

/** True when the harness has a running Postgres (false only on a local run without Docker). */
export function dbTestsAvailable(): boolean {
  return inject("dbAdminUrl") !== null;
}

function urlFor(adminUrl: string, user: string | null, password: string | null, database: string): string {
  const url = new URL(adminUrl);
  if (user !== null && password !== null) {
    url.username = user;
    url.password = password;
  }
  url.pathname = `/${database}`;
  return url.toString();
}

/** A fresh database cloned from the migrated template, for one test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminBase = inject("dbAdminUrl");
  if (adminBase === null) {
    throw new Error("createTestDatabase() called without a database: guard with dbTestsAvailable().");
  }
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: urlFor(adminBase, null, null, "postgres") });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE} OWNER satis_migrator`);
  } finally {
    await admin.end();
  }
  return {
    name,
    adminUrl: urlFor(adminBase, null, null, name),
    appUrl: urlFor(adminBase, "satis_app", APP_PASSWORD, name),
    migratorUrl: urlFor(adminBase, "satis_migrator", MIGRATOR_PASSWORD, name),
    backupUrl: urlFor(adminBase, "satis_backup", BACKUP_PASSWORD, name),
    async drop() {
      const dropper = new pg.Client({ connectionString: urlFor(adminBase, null, null, "postgres") });
      await dropper.connect();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}
