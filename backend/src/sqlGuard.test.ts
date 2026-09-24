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
    } else if ((ch === "," || ch === ";") && depth === 0) {
      break; // the argument ends at a top-level comma, and a declaration's value at its ";"
    }
  }
  return code.slice(open, i);
}

/** Escapes every regular-expression metacharacter (including the backslash itself). */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  // `.query(`, `.query<Row>(`, `.query?.(`, `.query!(`, `["query"](`; generics may contain parens.
  for (const match of code.matchAll(/(?:\.query|\[\s*["']query["']\s*\])\s*[?!]?\.?\s*(?:<[^`;]*?>\s*)?\(/g)) {
    const start = match.index + match[0].length;
    const argument = firstArgument(code, start);
    if (buildsTextFromInput(argument)) {
      calls.push(`${match[0]}${argument}`);
      continue;
    }
    // A bare variable: look at how it was declared in this file (`const q = \`...${x}\``).
    const name = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(argument)?.[1];
    if (name !== undefined) {
      const declaration = new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\b[^=]*=`, "g");
      for (const decl of code.matchAll(declaration)) {
        const value = firstArgument(code, decl.index + decl[0].length).trim();
        const rest = code.slice(decl.index + decl[0].length).split(/;\s*\n/)[0] ?? "";
        if (buildsTextFromInput(value) || buildsTextFromInput(rest)) {
          calls.push(`${match[0]}${argument} (declared: ${rest.slice(0, 60)})`);
          break;
        }
      }
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
      ["a multi-line call", "db.query(\n  `SELECT * FROM t\n WHERE id = ${id}`,\n [a])"],
      ["a nested generic", "db.query<{ a: Map<string, number> }>(`SELECT ${x}`)"],
      ["a generic with parentheses", "db.query<Row & (A | B)>(`SELECT ${x}`)"],
      ["bracket access", 'db["query"](`SELECT ${x}`)'],
      ["an optional call", "db.query?.(`SELECT ${x}`)"],
      ["a non-null call", "db.query!(`SELECT ${x}`)"],
      ["a variable built earlier by concatenation", 'const q = "SELECT " + col;\ndb.query(q)'],
      ["a variable built earlier by a template", "const q = `SELECT ${col}`;\ndb.query(q, [])"],
      ["an unsafe call after a safe one with a paren in its string", 'db.query("SELECT (1)"); db.query(`x${y}`)'],
      ["an apostrophe in a trailing comment before the call", "foo(); // don't\ndb.query(`x${y}`)"],
    ])("flags %s", (_label, source) => {
      expect(unsafeQueryCalls(source)).not.toEqual([]);
    });

    it.each([
      ["a plain constant with parameters", 'db.query("SELECT 1 FROM pgmigrations WHERE name = $1", [name])'],
      ["a static template without interpolation", "db.query(`SELECT 1`)"],
      ["a named constant", "db.query(APPLIED_QUERY, [latest])"],
      ["a commented-out unsafe call", "// db.query(`SELECT ${x}`)"],
      ["a plus sign inside the SQL string", 'db.query("SELECT a + b FROM t")'],
      [
        "a SQL constant followed by an unrelated interpolated template",
        "const Q = `SELECT 1`;\nfunction f() { throw new Error(`bad ${x}`); }\ndb.query(Q)",
      ],
      ["an escaped dollar in a template", "db.query(`SELECT \\${x}`)"],
      ["a plus in a trailing comment", 'db.query("SELECT 1", [a]) // x + y'],
    ])("allows %s", (_label, source) => {
      expect(unsafeQueryCalls(source)).toEqual([]);
    });

    it("terminates on unterminated or pathological input", () => {
      const pieces = ['"', "'", "`", "${", "}", "(", ".query(", ".query<", "\\", "+", "/*", "//", "\n", "a"];
      let seed = 1;
      const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const started = Date.now();
      for (let n = 0; n < 300; n++) {
        let source = "";
        for (let k = 0; k < 200; k++) {
          source += pieces[Math.floor(random() * pieces.length)];
        }
        unsafeQueryCalls(source);
      }
      unsafeQueryCalls(".query(`${".repeat(3000));
      expect(Date.now() - started).toBeLessThan(5000);
    });
  });
});
