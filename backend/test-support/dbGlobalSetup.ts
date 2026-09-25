import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { provisionDatabase, migrateUp } from "../src/platform/db/admin.js";
import { startOrSkip } from "./harnessPolicy.js";

declare module "vitest" {
  export interface ProvidedContext {
    /** Superuser URL of the test Postgres, or null when Docker is unavailable (local runs only). */
    dbAdminUrl: string | null;
  }
}

export const TEMPLATE_DATABASE = "satis_template";
export const MIGRATOR_PASSWORD = "migrator-test-password";
export const APP_PASSWORD = "app-test-password";
export const BACKUP_PASSWORD = "backup-test-password";

/**
 * ADR-0025: one Postgres container per test run, migrated once into a template database; each
 * DB test file then clones it (CREATE DATABASE ... TEMPLATE), so files are isolated and cheap.
 * Postgres 18, like production.
 */
export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  // A local opt-out for narrow runs of unrelated tests (saves the container start). Never in CI.
  if (process.env.SKIP_DB_TESTS === "1" && !process.env.CI) {
    project.provide("dbAdminUrl", null);
    return;
  }
  const started = await startOrSkip(
    async () => {
      const container = await new PostgreSqlContainer("postgres:18").withUsername("postgres").withPassword("postgres").start();
      return container;
    },
    process.env,
    (message) => console.error(message),
  );
  if (started === null) {
    project.provide("dbAdminUrl", null);
    return;
  }
  const adminUrl = started.getConnectionUri();
  await provisionDatabase({
    adminUrl,
    database: TEMPLATE_DATABASE,
    migratorPassword: MIGRATOR_PASSWORD,
    appPassword: APP_PASSWORD,
    backupPassword: BACKUP_PASSWORD,
  });
  const migratorUrl = new URL(adminUrl);
  migratorUrl.username = "satis_migrator";
  migratorUrl.password = MIGRATOR_PASSWORD;
  migratorUrl.pathname = `/${TEMPLATE_DATABASE}`;
  await migrateUp(migratorUrl.toString());
  project.provide("dbAdminUrl", adminUrl);
  return async () => {
    await started.stop();
  };
}
