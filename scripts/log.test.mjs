import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assembleLog, compact, FRAGMENT_NAME, readFragments } from "./log.mjs";

function workspace(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "log-test-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

test("fragment names are date, then a lowercase slug", () => {
  assert.ok(FRAGMENT_NAME.test("2026-09-26-history-storage.md"));
  assert.ok(!FRAGMENT_NAME.test("README.md"));
  assert.ok(!FRAGMENT_NAME.test("2026-09-26-.md"));
  assert.ok(!FRAGMENT_NAME.test("2026-09-26-Bad.md"));
});

test("readFragments sorts by file name, skips the README and empty files, and trims", () => {
  const dir = workspace({
    "README.md": "explains the folder",
    "2026-09-27-b.md": "- b\n\n",
    "2026-09-26-z.md": "- z\n",
    "2026-09-26-a.md": "- a\n",
    "2026-09-28-empty.md": "  \n",
    "notes.txt": "ignored",
  });
  try {
    assert.deepEqual(
      readFragments(dir).map((f) => [f.name, f.text]),
      [
        ["2026-09-26-a.md", "- a"],
        ["2026-09-26-z.md", "- z"],
        ["2026-09-27-b.md", "- b"],
      ],
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("readFragments of a folder that does not exist is empty", () => {
  assert.deepEqual(readFragments(path.join(tmpdir(), "no-such-log-dir-xyz")), []);
});

test("assembleLog puts the fragments after log.md and ends with one newline", () => {
  assert.equal(assembleLog("# Log\n\n- old\n\n", [{ text: "- a" }, { text: "- b" }]), "# Log\n\n- old\n- a\n- b\n");
  assert.equal(assembleLog("# Log\n", []), "# Log\n");
});

test("compact folds the fragments into log.md, deletes them, and keeps the README", () => {
  const dir = workspace({ "README.md": "readme", "2026-09-26-a.md": "- a\n", "2026-09-27-b.md": "- b\n" });
  const logFile = path.join(dir, "log.md");
  writeFileSync(logFile, "# Log\n\n- old\n");
  try {
    assert.equal(compact({ logFile, dir }), 2);
    assert.equal(readFileSync(logFile, "utf8"), "# Log\n\n- old\n- a\n- b\n");
    assert.deepEqual(readdirSync(dir).sort(), ["README.md", "log.md"]);
    assert.equal(compact({ logFile, dir }), 0); // nothing left: log.md untouched
    assert.equal(readFileSync(logFile, "utf8"), "# Log\n\n- old\n- a\n- b\n");
    assert.ok(existsSync(path.join(dir, "README.md")));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
