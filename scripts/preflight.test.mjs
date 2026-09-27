import { test } from "node:test";
import assert from "node:assert/strict";
import { PATH_PATTERNS, addedLines, checkNodeModules, checkPr, scanLines, scanMessages } from "./preflight.mjs";

// The path shapes are taken from the module, so this file does not contain them literally (CI's PII scan would flag it).
const [WINDOWS_PATH] = PATH_PATTERNS;

const DIFF = [
  "diff --git a/docs/a.md b/docs/a.md",
  "--- a/docs/a.md",
  "+++ b/docs/a.md",
  "@@ -1,2 +10,3 @@",
  " context",
  "+first added",
  "+second added",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -5,0 +7 @@",
  "+third added",
  "diff --git a/gone.txt b/gone.txt",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-removed",
].join("\n");

test("addedLines reads the file and the new line number of every added line, and ignores removals", () => {
  assert.deepEqual(addedLines(DIFF), [
    { file: "docs/a.md", line: 11, text: "first added" },
    { file: "docs/a.md", line: 12, text: "second added" },
    { file: "src/b.ts", line: 7, text: "third added" },
  ]);
});

test("a local absolute path in an added line is a hit, reported by file and line, never by its text", () => {
  const lines = [{ file: "docs/a.md", line: 3, text: `see ${WINDOWS_PATH}\\someone\\repo` }];
  const hits = scanLines(lines, PATH_PATTERNS);
  assert.deepEqual(hits, [{ file: "docs/a.md", line: 3, pattern: 0 }]);
  assert.equal(JSON.stringify(hits).includes("someone"), false);
});

test("the scan is case-insensitive and reports every pattern that matches", () => {
  const lines = [{ file: "x.md", line: 1, text: `${WINDOWS_PATH.toUpperCase()} and secret-name` }];
  const hits = scanLines(lines, [...PATH_PATTERNS, "Secret-Name"]);
  assert.deepEqual(
    hits.map((hit) => hit.pattern),
    [0, PATH_PATTERNS.length],
  );
});

test("clean lines and blank patterns produce no hits", () => {
  assert.deepEqual(scanLines([{ file: "x.md", line: 1, text: "nothing to see" }], [...PATH_PATTERNS, ""]), []);
});

test("this script and its test are exempt from the scan, as is the LICENSE", () => {
  for (const file of ["scripts/preflight.mjs", "scripts/preflight.test.mjs", "LICENSE"]) {
    assert.deepEqual(scanLines([{ file, line: 1, text: WINDOWS_PATH }], PATH_PATTERNS), [], file);
  }
  assert.equal(scanLines([{ file: "scripts/other.mjs", line: 1, text: WINDOWS_PATH }], PATH_PATTERNS).length, 1);
});

test("commit messages are scanned line by line", () => {
  const hits = scanMessages(`fix: a thing\n\nran it from ${WINDOWS_PATH}\\x`, PATH_PATTERNS);
  assert.deepEqual(hits, [{ file: "(commit message)", line: 3, pattern: 0 }]);
});

test("a PR that is not OPEN blocks the push; a CONFLICTING one too; a clean one and no PR do not", () => {
  assert.equal(checkPr({ state: "MERGED", mergeable: "UNKNOWN" }).length, 1);
  assert.match(checkPr({ state: "MERGED", mergeable: "UNKNOWN" })[0], /MERGED.*Branch fresh from origin\/main/);
  assert.equal(checkPr({ state: "CLOSED", mergeable: "MERGEABLE" }).length, 1);
  assert.match(checkPr({ state: "OPEN", mergeable: "CONFLICTING" })[0], /CONFLICTING/);
  assert.deepEqual(checkPr({ state: "OPEN", mergeable: "MERGEABLE" }), []);
  assert.deepEqual(checkPr({ state: "OPEN", mergeable: "UNKNOWN" }), []);
  assert.deepEqual(checkPr(undefined), []);
});

test("an empty or missing node_modules is a problem", () => {
  assert.equal(checkNodeModules([]).length, 1);
  assert.match(checkNodeModules([])[0], /npm ci/);
  assert.deepEqual(checkNodeModules(["react", ".bin"]), []);
});
