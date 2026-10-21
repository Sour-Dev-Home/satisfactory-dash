/**
 * The name (file name without ".sql") of the newest migration in backend/migrations, bundled into
 * the build so startup can check the schema without reading the file system. Update it together
 * with every new migration: latestMigration.test.ts fails when the two disagree.
 */
export const LATEST_MIGRATION = "1791417600000_purge_removed_server_leftovers";
