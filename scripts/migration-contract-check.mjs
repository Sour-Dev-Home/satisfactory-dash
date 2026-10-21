// Migration contract check (ADR-0049 D6, expand then contract).
//
// A migration must be expand-only: the running (old) backend has to keep working on the new schema, and after a
// rollback. A "contract" step (drop, rename, retype, SET NOT NULL, a new CHECK on existing rows, a NOT NULL column
// with no default) ships in a later release and says why it is safe in a `-- contract: <why>` line in the file.
//
//   node scripts/migration-contract-check.mjs [<migrations-dir>]     (default: backend/migrations)
//
// Only the Up section is read (everything before `-- Down Migration`); rollbacks are allowed to contract.
// Comments and string literals are blanked before matching. Objects created in the same file may be dropped,
// since no earlier release can depend on them. Static analysis cannot know whether a CHECK meets existing rows, so a
// CHECK is exempt when it is NOT VALID, sits on a table created in the file, replaces a same-named constraint
// (widening), or the same file adds a column to, or drops a NOT NULL on, that table.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACT_LINE = /^[ \t]*--[ \t]*contract:[ \t]*\S/im;
const DOWN_MARKER = /^[ \t]*--[ \t]*down migration\b/im;

/** Blank comments and single-quoted literals (keeping length-free placeholders), unquote identifiers. */
export function sanitize(sql) {
  let out = "";
  for (let i = 0; i < sql.length; ) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (two === "/*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith("/*", i)) (depth++, (i += 2));
        else if (sql.startsWith("*/", i)) (depth--, (i += 2));
        else i++;
      }
      out += " ";
    } else if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      out += "''";
    } else if (sql[i] === '"') {
      const end = sql.indexOf('"', i + 1);
      out += sql.slice(i + 1, end < 0 ? sql.length : end);
      i = end < 0 ? sql.length : end + 1;
    } else {
      out += sql[i++];
    }
  }
  return out;
}

/** Split on top-level characters (depth 0 in parentheses). */
function splitTop(text, sep) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) (parts.push(cur), (cur = ""));
    else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const lastName = (ref) => ref.split(".").pop().toLowerCase();
const NAME = String.raw`((?:[\w$]+\.)?[\w$]+)`;

export function checkMigration(sql) {
  const up = sql.split(DOWN_MARKER)[0];
  if (CONTRACT_LINE.test(up)) return []; // justified: the author states why contracting is safe now
  const statements = splitTop(sanitize(up), ";");

  // Pass 1: what this file creates.
  const created = new Set(); // "kind:name"
  const tablesWithNewColumns = new Set();
  const addedConstraints = new Set();
  const relaxedTables = new Set();
  const parsed = [];
  for (const stmt of statements) {
    const create = stmt.match(new RegExp(`^CREATE (?:UNIQUE )?(?:OR REPLACE )?(?:TEMP(?:ORARY)? )?(TABLE|INDEX|SCHEMA|TYPE|VIEW|MATERIALIZED VIEW|SEQUENCE|FUNCTION|TRIGGER|POLICY|DOMAIN)(?: CONCURRENTLY)?(?: IF NOT EXISTS)? ${NAME}`, "i"));
    if (create) created.add(`${create[1].toLowerCase()}:${lastName(create[2])}`);
    const alter = stmt.match(new RegExp(`^ALTER TABLE(?: IF EXISTS)?(?: ONLY)? ${NAME} (.*)$`, "is"));
    if (alter) {
      const table = lastName(alter[1]);
      const actions = splitTop(alter[2], ",");
      parsed.push({ table, actions });
      for (const a of actions) {
        const col = a.match(new RegExp(`^ADD (?:COLUMN )?(?:IF NOT EXISTS )?${NAME}`, "i"));
        if (/^ADD (COLUMN|(?!CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE))/i.test(a) && col) {
          created.add(`column:${lastName(col[1])}`);
          tablesWithNewColumns.add(table);
        }
        const con = a.match(new RegExp(`^ADD CONSTRAINT ${NAME}`, "i"));
        if (con) (created.add(`constraint:${lastName(con[1])}`), addedConstraints.add(lastName(con[1])));
        if (/^ALTER (?:COLUMN )?\S+ DROP NOT NULL/i.test(a)) relaxedTables.add(table);
      }
    }
  }
  const tableIsNew = (t) => created.has(`table:${t}`);

  const problems = [];
  const flag = (stmt, why) => problems.push(`${why}: ${stmt.slice(0, 110)}`);

  // Pass 2: contract operations.
  for (const stmt of statements) {
    const drop = stmt.match(new RegExp(`^DROP (TABLE|INDEX|SCHEMA|TYPE|VIEW|MATERIALIZED VIEW|SEQUENCE|FUNCTION|TRIGGER|POLICY|DOMAIN)(?: CONCURRENTLY)?(?: IF EXISTS)? ${NAME}`, "i"));
    if (drop && !created.has(`${drop[1].toLowerCase()}:${lastName(drop[2])}`)) flag(stmt, `drops existing ${drop[1].toLowerCase()}`);
    if (/^ALTER (?:TABLE|INDEX|SCHEMA|TYPE|VIEW|MATERIALIZED VIEW|SEQUENCE) .*\bRENAME\b/i.test(stmt)) flag(stmt, "renames");
  }
  for (const { table, actions } of parsed) {
    for (const a of actions) {
      const dropCol = a.match(new RegExp(`^DROP (?:COLUMN )?(?:IF EXISTS )?${NAME}`, "i"));
      if (/^DROP COLUMN /i.test(a) && dropCol && !created.has(`column:${lastName(dropCol[1])}`)) flag(a, "drops existing column");
      const dropCon = a.match(new RegExp(`^DROP CONSTRAINT(?: IF EXISTS)? ${NAME}`, "i"));
      if (dropCon && !created.has(`constraint:${lastName(dropCon[1])}`)) flag(a, "drops existing constraint");
      if (/\bRENAME\b/i.test(a)) flag(a, "renames");
      if (/^ALTER (?:COLUMN )?\S+ (?:SET DATA )?TYPE\b/i.test(a)) flag(a, "retypes a column");
      if (/^ALTER (?:COLUMN )?\S+ SET NOT NULL/i.test(a)) flag(a, "sets NOT NULL");
      const add = a.match(new RegExp(`^ADD CONSTRAINT ${NAME} CHECK\\b`, "i")) ?? a.match(/^ADD CHECK\b/i);
      if (add && !/\bNOT VALID\b/i.test(a)) {
        const name = add[1] ? lastName(add[1]) : "";
        const replacesDropped = statements.some((s) => new RegExp(`DROP CONSTRAINT(?: IF EXISTS)? (?:[\\w$]+\\.)?${name}\\b`, "i").test(s)) && name;
        if (!tableIsNew(table) && !replacesDropped && !tablesWithNewColumns.has(table) && !relaxedTables.has(table)) flag(a, "adds a CHECK to existing rows");
      }
      if (/^ADD (?:COLUMN )?(?!CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)/i.test(a) && /\bNOT NULL\b/i.test(a) && !/\b(DEFAULT|GENERATED)\b/i.test(a) && !tableIsNew(table)) {
        flag(a, "adds a NOT NULL column without a default");
      }
    }
  }
  return problems;
}

export function checkDirectory(dir) {
  const results = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const problems = checkMigration(readFileSync(path.join(dir, file), "utf8"));
    if (problems.length) results.push({ file, problems });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "backend", "migrations");
  const failures = checkDirectory(dir);
  for (const { file, problems } of failures) {
    for (const p of problems) console.error(`${file}: ${p}`);
    console.error(`${file}: add a "-- contract: <why it is safe now>" line (ADR-0049 D6) or make the migration expand-only.`);
  }
  if (failures.length) process.exit(1);
  console.log(`migration-contract-check: ${dir} ok`);
}
