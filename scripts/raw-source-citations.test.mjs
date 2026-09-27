// #343: third-party pages in docs-vault/raw-sources are kept as numbered excerpts (### E<n> — ...), cited by ID.
// This fails on a `<file>.md:<line>` citation to one of those files, and on a citation of an excerpt ID the file
// doesn't have. The frozen wiki log (log.md, log.d/) keeps its old line references: it's history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = "docs-vault/raw-sources/";
const FROZEN = /^docs-vault\/wiki\/(log\.md|log\.d\/)/;
const EXCERPT_HEADING = /^### (E\d+) — /gm;

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter((file) => file !== "" && !FROZEN.test(file) && !/\.(png|jpe?g|gif|ico|webp|woff2?|pdf|zip)$/i.test(file));
const read = (file) => {
  try {
    return readFileSync(path.join(root, file), "utf8");
  } catch {
    return ""; // deleted in the working tree
  }
};

/** Excerpt files and the IDs each one has. */
const excerptFiles = new Map(
  tracked
    .filter((file) => file.startsWith(RAW) && file.endsWith(".md"))
    .map((file) => [path.basename(file), new Set([...read(file).matchAll(EXCERPT_HEADING)].map((m) => m[1]))])
    .filter(([, ids]) => ids.size > 0),
);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = [...excerptFiles.keys()].map(escape).join("|");

test("the trimmed third-party pages are excerpt files", () => {
  for (const name of ["dedicated-server-api.md", "frm-read-api.md", "frm-getFactory.md", "frm-getPower.md"]) {
    assert.ok(excerptFiles.has(name), `${name} has no "### E1 — " excerpts`);
  }
});

test("no citation of an excerpt file by line number, outside the frozen log", () => {
  const byLine = new RegExp(`(?<![\\w-])(${names})\`?:\\d`, "g");
  const found = tracked.flatMap((file) =>
    read(file)
      .split(/\r?\n/)
      .flatMap((line, i) => [...line.matchAll(byLine)].map((m) => `${file}:${i + 1}: ${m[0]}`)),
  );
  assert.deepEqual(found, [], "cite the excerpt ID (e.g. `frm-getFactory.md` E3) instead");
});

test("every cited excerpt ID exists in its file", () => {
  // `dedicated-server-api.md E5`, `frm-getFactory.md` E3, frm-getFactory.md E3, E6
  const cite = new RegExp(`(?<![\\w-])(${names})\`? (E\\d+(?:(?:, | and )E\\d+)*)`, "g");
  const missing = tracked.flatMap((file) =>
    [...read(file).matchAll(cite)].flatMap((m) =>
      m[2]
        .split(/, | and /)
        .filter((id) => !excerptFiles.get(m[1]).has(id))
        .map((id) => `${file}: ${m[1]} ${id}`),
    ),
  );
  assert.deepEqual(missing, []);
});
