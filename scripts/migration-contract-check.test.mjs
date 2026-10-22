import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { LEGACY_CHECK_FILES, checkDirectory, checkMigration } from "./migration-contract-check.mjs";

const flagged = (sql) => checkMigration(`-- Up Migration\n${sql}\n-- Down Migration\nDROP TABLE x;`).length > 0;

test("expand-only statements pass", () => {
  assert.equal(flagged("CREATE TABLE a.t (id uuid PRIMARY KEY, n text NOT NULL DEFAULT 'x');"), false);
  assert.equal(flagged("ALTER TABLE a.t ADD COLUMN c text, ADD COLUMN d int NOT NULL DEFAULT 0;"), false);
  assert.equal(flagged("ALTER TABLE a.t ALTER COLUMN c DROP NOT NULL;"), false);
  assert.equal(flagged("ALTER TABLE a.t ALTER COLUMN c DROP DEFAULT;"), false);
  assert.equal(flagged("CREATE INDEX t_c_idx ON a.t (c);"), false);
  assert.equal(flagged("ALTER TYPE a.kind ADD VALUE 'z';"), false);
  assert.equal(flagged("UPDATE a.t SET c = 'x' WHERE c IS NULL;"), false);
});

test("each contract operation is flagged", () => {
  for (const sql of [
    "DROP TABLE a.t;",
    "DROP TABLE IF EXISTS a.t;",
    "DROP INDEX a.t_idx;",
    "DROP SCHEMA a CASCADE;",
    "ALTER TABLE a.t DROP COLUMN c;",
    "ALTER TABLE a.t DROP COLUMN IF EXISTS c;",
    "ALTER TABLE a.t DROP CONSTRAINT t_chk;",
    "ALTER TABLE a.t RENAME TO u;",
    "ALTER TABLE a.t RENAME COLUMN c TO d;",
    "ALTER TABLE a.t ALTER COLUMN c TYPE bigint;",
    "ALTER TABLE a.t ALTER COLUMN c SET DATA TYPE bigint;",
    "ALTER TABLE a.t ALTER COLUMN c SET NOT NULL;",
    "ALTER TABLE a.t ADD COLUMN c text NOT NULL;",
    "ALTER TABLE a.t ADD CONSTRAINT t_chk CHECK (n > 0);",
    "ALTER TABLE a.t ADD COLUMN ok text, DROP COLUMN old;",
  ]) {
    assert.equal(flagged(sql), true, sql);
  }
});

test("a -- contract: line with a reason justifies the file", () => {
  const sql = "-- contract: no rollback target reads t.c since release 2026-11\nALTER TABLE a.t DROP COLUMN c;";
  assert.deepEqual(checkMigration(sql), []);
});

test("an empty contract line does not count", () => {
  assert.equal(checkMigration("-- contract:\nALTER TABLE a.t DROP COLUMN c;").length, 1);
  assert.equal(checkMigration("-- not a contract: line\nDROP TABLE a.t;").length, 1);
});

test("comments and string literals do not trip the check", () => {
  assert.equal(flagged("-- we DROP TABLE a.t later\nSELECT 1;"), false);
  assert.equal(flagged("/* ALTER TABLE a.t DROP COLUMN c; */ SELECT 1;"), false);
  assert.equal(flagged("INSERT INTO a.t (n) VALUES ('DROP TABLE x; ALTER COLUMN c SET NOT NULL');"), false);
  assert.equal(flagged("INSERT INTO a.t (n) VALUES ('it''s; DROP TABLE x');"), false);
});

test("the Down section may contract", () => {
  assert.deepEqual(checkMigration("-- Up Migration\nCREATE TABLE a.t (id int);\n-- Down Migration\nDROP TABLE a.t;\nALTER TABLE a.u DROP COLUMN c;"), []);
});

test("objects created in the same file may be dropped", () => {
  assert.equal(flagged("CREATE TABLE a.tmp (id int);\nDROP TABLE a.tmp;"), false);
  assert.equal(flagged("ALTER TABLE a.t ADD COLUMN c text;\nALTER TABLE a.t DROP COLUMN c;"), false);
  assert.equal(flagged("CREATE INDEX i ON a.t (c);\nDROP INDEX IF EXISTS a.i;"), false);
  assert.equal(flagged("CREATE TABLE a.tmp (id int);\nDROP TABLE a.other;"), true);
});

test("CHECK constraints: new ones on existing rows are flagged, safe shapes are not", () => {
  assert.equal(flagged("ALTER TABLE a.t ADD CONSTRAINT c1 CHECK (n > 0);"), true);
  assert.equal(flagged("ALTER TABLE a.t ADD CONSTRAINT c1 CHECK (n > 0) NOT VALID;"), false);
  assert.equal(flagged("CREATE TABLE a.t (n int);\nALTER TABLE a.t ADD CONSTRAINT c1 CHECK (n > 0);"), false);
  assert.equal(flagged("ALTER TABLE a.t DROP CONSTRAINT c1;\nALTER TABLE a.t ADD CONSTRAINT c1 CHECK (k IN ('a','b'));"), false);
});

test("CHECK constraints: adding a column or dropping a NOT NULL exempts only the legacy files (#587)", () => {
  const addCol = "ALTER TABLE a.t ADD COLUMN x int, ADD CONSTRAINT c1 CHECK (y > 0);";
  const relax = "ALTER TABLE a.t ALTER COLUMN x DROP NOT NULL;\nALTER TABLE a.t ADD CONSTRAINT c1 CHECK (x IS NOT NULL OR y);";
  for (const sql of [addCol, relax]) {
    assert.equal(checkMigration(sql).length > 0, true, sql);
    assert.deepEqual(checkMigration(sql, { legacyCheckExemption: true }), [], sql);
  }
  // What a new file writes instead.
  assert.deepEqual(checkMigration("ALTER TABLE a.t ADD COLUMN x int, ADD CONSTRAINT c1 CHECK (y > 0) NOT VALID;"), []);
});

test("the legacy exemption is keyed by filename", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mig-"));
  const sql = "ALTER TABLE a.t ADD COLUMN x int, ADD CONSTRAINT c1 CHECK (y > 0);";
  writeFileSync(path.join(dir, [...LEGACY_CHECK_FILES][0]), sql);
  writeFileSync(path.join(dir, "1799999999999_new.sql"), sql);
  assert.deepEqual(checkDirectory(dir).map((r) => r.file), ["1799999999999_new.sql"]);
});

test("the repository's existing migrations all pass", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  assert.deepEqual(checkDirectory(path.join(here, "..", "backend", "migrations")), []);
});
