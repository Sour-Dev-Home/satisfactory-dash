import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { QUERY_NAMES } from "../metrics/registry.js";

/**
 * ADR-0037 build step 4 (#461): every query under modules/ and platform/ goes through `timedQuery`
 * with a static name, and the registry's closed list of names is exactly the names the code uses.
 * Read from source, like architecture.test.ts, so a new direct `.query(` or an unregistered name
 * fails here and not only at runtime.
 */
const SRC = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const FILES = new Map(
  [...sourceFiles(join(SRC, "modules")), ...sourceFiles(join(SRC, "platform"))].map((path) => [
    relative(SRC, path).split(sep).join("/"),
    readFileSync(path, "utf8"),
  ]),
);

/** The only direct `.query(` calls left, with how many each file may hold, so a new one in an
 *  allowlisted file fails too. */
const DIRECT_QUERY_ALLOWLIST = new Map([
  ["platform/db/timedQuery.ts", 2], // the helper itself (with params, and without)
  ["platform/db/transaction.ts", 3], // BEGIN, COMMIT, ROLLBACK
  ["platform/db/database.ts", 2], // the readiness probe's SELECT 1
  ["platform/db/schemaVersion.ts", 1], // the schema check at startup
  ["platform/db/admin.ts", 22], // the admin bootstrap (migrations, roles, grants)
  ["platform/db/leaderLock.ts", 3], // ADR-0054: try-lock, SELECT 1 and unlock on the lock's own client, every 5 s (not a request's query)
]);

/** Also a generic (`.query<Row>(`) or spaced (`.query (`) call, so those can't slip past. */
const DIRECT_QUERY = /\.query\s*(?:<[^()]*>)?\s*\(/g;
const TIMED_CALL = /\btimedQuery\(/g;
const TIMED_CALL_NAME = /\btimedQuery\(\s*[\w.]+\s*,\s*"([^"]+)"/g;

function namesInSource(): Set<string> {
  const names = new Set<string>();
  for (const [file, text] of FILES) {
    if (file === "platform/db/timedQuery.ts") continue;
    for (const match of text.matchAll(TIMED_CALL_NAME)) names.add(match[1]);
  }
  return names;
}

describe("timedQuery call sites (#461)", () => {
  it("scans a real tree", () => {
    expect(FILES.has("platform/db/transaction.ts")).toBe(true);
    expect(FILES.has("modules/identity/repositories/userRepository.ts")).toBe(true);
  });

  it("the direct-call pattern sees generic and spaced forms too", () => {
    const hits = (s: string) => s.match(DIRECT_QUERY)?.length ?? 0;
    expect(hits("db.query(sql)")).toBe(1);
    expect(hits("db.query<Row>(sql)")).toBe(1);
    expect(hits("db.query (sql)")).toBe(1);
    expect(hits("db.query\n(sql)")).toBe(1);
    expect(hits("timedQuery(db, \"a.b\", sql)")).toBe(0);
  });

  it("leaves no direct .query( call outside the allowlist", () => {
    const offenders: string[] = [];
    for (const [file, text] of FILES) {
      const count = text.match(DIRECT_QUERY)?.length ?? 0;
      if (count !== (DIRECT_QUERY_ALLOWLIST.get(file) ?? 0)) offenders.push(`${file}: ${count}`);
    }
    expect(offenders).toEqual([]);
  });

  it("names every timedQuery call with a string literal", () => {
    const unnamed: string[] = [];
    for (const [file, text] of FILES) {
      if (file === "platform/db/timedQuery.ts") continue;
      const calls = text.match(TIMED_CALL)?.length ?? 0;
      const named = [...text.matchAll(TIMED_CALL_NAME)].length;
      if (calls !== named) unnamed.push(`${file}: ${calls - named} of ${calls}`);
    }
    expect(unnamed).toEqual([]);
  });

  it("registers exactly the names the code passes: none missing, none lingering", () => {
    expect([...namesInSource()].sort()).toEqual([...QUERY_NAMES].sort());
  });

  it("lists each registered name once", () => {
    expect(new Set(QUERY_NAMES).size).toBe(QUERY_NAMES.length);
  });
});
