import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { MIGRATIONS_DIR } from "../../platform/db/admin.js";
import {
  RETURN_PATH_ACCEPTED,
  RETURN_PATH_REJECTED,
  RETURN_PATH_REJECTED_BY_ZOD_ONLY,
} from "../../../test-support/returnPathCases.js";
import { RETURN_PATH_MAX_LENGTH, RETURN_PATH_PATTERN, RETURN_PATH_REGEX_SOURCE, ReturnPathSchema } from "./returnPath.js";

describe("login return path (ASCII allowlist)", () => {
  it.each(RETURN_PATH_ACCEPTED)("accepts %s", (path) => {
    expect(RETURN_PATH_PATTERN.test(path)).toBe(true);
    expect(ReturnPathSchema.safeParse(path).success).toBe(true);
  });

  it.each([...RETURN_PATH_REJECTED, ...RETURN_PATH_REJECTED_BY_ZOD_ONLY])("rejects %s", (_label, path) => {
    expect(ReturnPathSchema.safeParse(path).success).toBe(false);
  });

  it("rejects a path longer than the limit and accepts one exactly at it", () => {
    const atLimit = `/app/${"a".repeat(RETURN_PATH_MAX_LENGTH - "/app/".length)}`;
    expect(atLimit).toHaveLength(RETURN_PATH_MAX_LENGTH);
    expect(ReturnPathSchema.safeParse(atLimit).success).toBe(true);
    expect(ReturnPathSchema.safeParse(`${atLimit}a`).success).toBe(false);
  });

  it("is linear on a hostile input (no catastrophic backtracking)", () => {
    const started = Date.now();
    ReturnPathSchema.safeParse(`/app${"/a".repeat(1000)}! `);
    ReturnPathSchema.safeParse(`/app${"/".repeat(2000)}\n`);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("is the SAME text the migration's CHECK constraint uses", () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/1790294400000_core_tables.sql`, "utf8");
    const literal = /return_path ~ '((?:[^']|'')*)'/.exec(sql)?.[1];
    expect(literal, "the return_path CHECK must contain a regex literal").toBeDefined();
    expect(literal!.replaceAll("''", "'")).toBe(RETURN_PATH_REGEX_SOURCE);
    expect(sql).toMatch(new RegExp(`length\\(return_path\\) <= ${RETURN_PATH_MAX_LENGTH}`));
    expect(sql).toMatch(/position\('\.\.' in return_path\) = 0/);
  });
});
