import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { MIGRATIONS_DIR } from "./admin.js";
import { LATEST_MIGRATION } from "./latestMigration.js";

const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql"));

describe("LATEST_MIGRATION", () => {
  it("is the newest file in backend/migrations (update it with every new migration)", () => {
    const names = migrationFiles()
      .map((file) => file.slice(0, -".sql".length))
      .sort();
    expect(names.length).toBeGreaterThan(0);
    expect(LATEST_MIGRATION).toBe(names[names.length - 1]);
  });

  it("migration files are named <timestamp>_<name> and carry an Up marker", () => {
    for (const file of migrationFiles()) {
      expect(file).toMatch(/^\d{13}_[a-z0-9_]+\.sql$/);
      expect(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8")).toMatch(/^-- Up Migration/m);
    }
  });
});
