import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMigrationFiles } from "./migration-immutable.mjs";

const M = "backend/migrations/1791331200000_web_push.sql";

test("a new migration passes; other files may change", () => {
  assert.deepEqual(checkMigrationFiles([
    { filename: "backend/migrations/1799999999999_new.sql", status: "added" },
    { filename: "backend/src/server.ts", status: "modified" },
    { filename: "docs/x.md", status: "removed" },
  ]), []);
});

test("an existing migration modified, removed or renamed fails", () => {
  assert.equal(checkMigrationFiles([{ filename: M, status: "modified" }])[0], `${M} was modified`);
  assert.equal(checkMigrationFiles([{ filename: M, status: "removed" }])[0], `${M} was removed`);
  assert.match(checkMigrationFiles([{ filename: "backend/migrations/x.sql", previous_filename: M, status: "renamed" }])[0], /was renamed to/);
  assert.match(checkMigrationFiles([{ filename: "backend/old/m.sql", previous_filename: M, status: "renamed" }])[0], /was renamed to backend\/old/);
});

test("a file moved into the migrations directory must be added, not renamed in", () => {
  assert.match(checkMigrationFiles([{ filename: M, previous_filename: "tmp/m.sql", status: "renamed" }])[0], /renamed from outside/);
});

test("GitHub's other statuses on a migration fail too", () => {
  for (const status of ["changed", "copied", "unchanged"]) assert.equal(checkMigrationFiles([{ filename: M, status }]).length, 1, status);
});
