import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * ADR-0025 decision 2 guardrail (no query builder): SQL is hand-written and parameterized, never
 * built from input. This fitness function scans production source for the two ways to break that
 * (interpolating into a query string, or concatenating one) and for `pg` being imported outside
 * the places allowed to hold SQL.
 */
const SRC = path.dirname(fileURLToPath(import.meta.url));

/** Files that may use the pg driver: platform/db, and the repository files future modules add. */
function mayUsePg(rel: string): boolean {
  return rel.startsWith("platform/db/") || /(^|\/)[A-Za-z]*Repository\.ts$/.test(rel) || /(^|\/)repositories\//.test(rel);
}

/** Operator tooling that runs DDL, which cannot take parameters: it escapes with pg's
 *  escapeLiteral/escapeIdentifier and is never part of the bundled server. */
const DDL_TOOLING = new Set(["platform/db/admin.ts"]);

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__fixtures__" ? [] : productionFiles(full);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

/** Query calls whose text is a template literal with ${...} or a string concatenation. */
export function unsafeQueryCalls(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const patterns = [
    /\.query\(\s*`[^`]*\$\{[^`]*`/g, // .query(`... ${x} ...`)
    /\.query\(\s*(?:"[^"\n]*"|'[^'\n]*')\s*\+/g, // .query("..." + x)
    /\.query\(\s*[A-Za-z_$][\w$.]*\s*\+/g, // .query(x + "...")
    /\.query\(\s*\{\s*text:\s*`[^`]*\$\{/g, // .query({ text: `... ${x}` })
  ];
  return patterns.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[0]));
}

describe("SQL guard (ADR-0025)", () => {
  const files = productionFiles(SRC).map((file) => ({ rel: path.relative(SRC, file).replaceAll("\\", "/"), file }));

  it("no production query is built by interpolation or concatenation", () => {
    const offenders = files
      .filter(({ rel }) => !DDL_TOOLING.has(rel))
      .flatMap(({ rel, file }) => unsafeQueryCalls(readFileSync(file, "utf8")).map((call) => `${rel}: ${call}`));
    expect(offenders).toEqual([]);
  });

  it("the pg driver is imported only in platform/db and repository files", () => {
    const offenders = files
      .filter(({ rel }) => !mayUsePg(rel))
      .filter(({ file }) => /from\s+["']pg["']|require\(\s*["']pg["']\s*\)/.test(readFileSync(file, "utf8")))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  describe("the guard itself", () => {
    it.each([
      ["a template with interpolation", "db.query(`SELECT * FROM t WHERE id = ${id}`)"],
      ["a template in a config object", "pool.query({ text: `SELECT ${col} FROM t` })"],
      ["a concatenated string", 'db.query("SELECT * FROM t WHERE id = " + id)'],
      ["a concatenated variable", "client.query(sql + suffix)"],
    ])("flags %s", (_label, source) => {
      expect(unsafeQueryCalls(source)).not.toEqual([]);
    });

    it.each([
      ["a plain constant with parameters", 'db.query("SELECT 1 FROM pgmigrations WHERE name = $1", [name])'],
      ["a static template without interpolation", "db.query(`SELECT 1`)"],
      ["a named constant", "db.query(APPLIED_QUERY, [latest])"],
      ["a commented-out unsafe call", "// db.query(`SELECT ${x}`)"],
    ])("allows %s", (_label, source) => {
      expect(unsafeQueryCalls(source)).toEqual([]);
    });
  });
});
