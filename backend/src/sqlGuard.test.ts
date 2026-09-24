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

/**
 * The text of the first argument of the call whose "(" is at `open` (exclusive), up to the
 * top-level "," or ")": brackets are balanced, and quotes, escapes and template literals
 * (including `${}` interpolations) are skipped, so a comma or paren inside a string does not end it.
 */
function firstArgument(code: string, open: number): string {
  let depth = 0;
  let i = open;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      for (i++; i < code.length && code[i] !== ch; i++) {
        if (code[i] === "\\") {
          i++;
        }
      }
    } else if (ch === "`") {
      for (i++; i < code.length && code[i] !== "`"; i++) {
        if (code[i] === "\\") {
          i++;
        } else if (code[i] === "$" && code[i + 1] === "{") {
          let braces = 0;
          for (i++; i < code.length; i++) {
            braces += code[i] === "{" ? 1 : code[i] === "}" ? -1 : 0;
            if (braces === 0) {
              break;
            }
          }
        }
      }
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) {
        break;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      break;
    }
  }
  return code.slice(open, i);
}

/** A template literal that interpolates, or a "+" outside every string (concatenation). */
function buildsTextFromInput(argument: string): boolean {
  if (/`(?:[^`\\]|\\.)*\$\{/.test(argument)) {
    return true;
  }
  const withoutStrings = argument
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  return withoutStrings.includes("+");
}

/** Query calls (`.query(` or a typed `.query<Row>(`) whose SQL text is interpolated or concatenated. */
export function unsafeQueryCalls(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const calls: string[] = [];
  for (const match of code.matchAll(/\.query\s*(?:<[^()]*>)?\s*\(/g)) {
    const start = match.index + match[0].length;
    const argument = firstArgument(code, start);
    if (buildsTextFromInput(argument)) {
      calls.push(`${match[0]}${argument}`);
    }
  }
  return calls;
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
      ["a typed call with interpolation", "pool.query<Row>(`SELECT * FROM t WHERE id = ${id}`)"],
      ["a typed call with concatenation", 'pool.query<Row>("SELECT * FROM t WHERE id = " + id)'],
      ["a template followed by concatenation", "db.query(`SELECT * FROM t WHERE id = ` + id)"],
      ["a string with escaped quotes then concatenation", 'db.query("SELECT \\"a\\" FROM t WHERE id = " + id)'],
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
