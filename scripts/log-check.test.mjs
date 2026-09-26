import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLogFragments, COMPACTION_LABEL, DEPENDABOT } from "./log-check.mjs";

const FRAGMENT = "docs-vault/wiki/log.d/2026-09-26-history-storage.md";
const added = (filename) => ({ filename, status: "added" });
const pr = (files, extra = {}) => ({ files, labels: [], author: "someone", ...extra });

test("a PR that adds one fragment passes", () => {
  const result = checkLogFragments(pr([added(FRAGMENT), { filename: "backend/src/x.ts", status: "modified" }]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
});

test("the CI jq shape (previous_filename: null on every file) still passes an added fragment", () => {
  const files = [
    { filename: FRAGMENT, status: "added", previous_filename: null },
    { filename: "backend/src/x.ts", status: "modified", previous_filename: null },
  ];
  assert.equal(checkLogFragments(pr(files)).ok, true);
});

test("look-alike paths are not fragments and do not satisfy the rule", () => {
  for (const filename of [
    "docs-vault/wiki/log.dx/2026-09-26-x.md",
    "docs-vault/wiki/log.d/sub/2026-09-26-x.md",
    "docs-vault/wiki/log.d/2026-09-26-x.md/y.md",
    "docs-vault/wiki/2026-09-26-x.md",
  ]) {
    assert.equal(checkLogFragments(pr([added(filename)])).ok, false, filename);
  }
});

test("a PR with no fragment fails, and says what to add", () => {
  const result = checkLogFragments(pr([{ filename: "backend/src/x.ts", status: "modified" }]));
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /adds no log fragment/);
  assert.match(result.problems[0], /log\.d\/<YYYY-MM-DD>-<branch-slug>\.md/);
});

test("a PR with no files at all fails", () => {
  assert.equal(checkLogFragments(pr([])).ok, false);
});

test("editing log.md fails, even with a fragment, and says to revert it", () => {
  const result = checkLogFragments(pr([added(FRAGMENT), { filename: "docs-vault/wiki/log.md", status: "modified" }]));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /log\.md is frozen/);
  assert.match(result.problems.join("\n"), /Revert/);
});

test("renaming or removing log.md fails too", () => {
  for (const file of [
    { filename: "docs-vault/wiki/log.md", status: "removed" },
    { filename: "docs-vault/wiki/old-log.md", previous_filename: "docs-vault/wiki/log.md", status: "renamed" },
  ]) {
    assert.equal(checkLogFragments(pr([added(FRAGMENT), file])).ok, false);
  }
});

test("editing an existing fragment fails", () => {
  const existing = "docs-vault/wiki/log.d/2026-09-25-older.md";
  const result = checkLogFragments(pr([added(FRAGMENT), { filename: existing, status: "modified" }]));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /already exists on main/);
});

test("removing or renaming an existing fragment fails", () => {
  const existing = "docs-vault/wiki/log.d/2026-09-25-older.md";
  for (const file of [
    { filename: existing, status: "removed" },
    { filename: "docs-vault/wiki/log.d/2026-09-25-newer.md", previous_filename: existing, status: "renamed" },
  ]) {
    assert.equal(checkLogFragments(pr([added(FRAGMENT), file])).ok, false);
  }
});

test("a fragment with a bad name fails", () => {
  for (const name of ["notes.md", "2026-9-26-x.md", "2026-09-26-Upper.md", "2026-09-26-x.txt", "sub/2026-09-26-x.md"]) {
    const result = checkLogFragments(pr([added(`docs-vault/wiki/log.d/${name}`)]));
    assert.equal(result.ok, false, name);
    assert.match(result.problems.join("\n"), /not a valid fragment name/);
  }
});

test("editing the log.d README is not a fragment edit, but does not count as a fragment either", () => {
  const readme = { filename: "docs-vault/wiki/log.d/README.md", status: "modified" };
  assert.equal(checkLogFragments(pr([added(FRAGMENT), readme])).ok, true);
  assert.equal(checkLogFragments(pr([readme])).ok, false);
});

test("two fragments in one PR pass", () => {
  const second = "docs-vault/wiki/log.d/2026-09-26-second-entry.md";
  assert.equal(checkLogFragments(pr([added(FRAGMENT), added(second)])).ok, true);
});

test("the log-compaction label is exempt and may edit log.md and fragments", () => {
  const result = checkLogFragments(
    pr(
      [
        { filename: "docs-vault/wiki/log.md", status: "modified" },
        { filename: "docs-vault/wiki/log.d/2026-09-25-older.md", status: "removed" },
      ],
      { labels: ["docs", COMPACTION_LABEL] },
    ),
  );
  assert.equal(result.ok, true);
  assert.match(result.exempt, /log-compaction/);
});

test("other labels do not exempt", () => {
  assert.equal(checkLogFragments(pr([], { labels: ["documentation", "dependencies"] })).ok, false);
});

test("Dependabot is exempt", () => {
  const result = checkLogFragments(pr([{ filename: "package-lock.json", status: "modified" }], { author: DEPENDABOT }));
  assert.equal(result.ok, true);
  assert.equal(result.exempt, "Dependabot");
});

test("a look-alike author is not Dependabot", () => {
  assert.equal(checkLogFragments(pr([], { author: "dependabot" })).ok, false);
  assert.equal(checkLogFragments(pr([], { author: "not-dependabot[bot]" })).ok, false);
});
