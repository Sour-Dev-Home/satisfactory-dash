import { test } from "node:test";
import assert from "node:assert/strict";
import { blockingStatus, globToRegExp, parseArgs, parseWorktrees, pickDispatchedRun, REPOS, repoFromRemote, scanDiff, selectFiles } from "./lib.mjs";

test("repoFromRemote reads https and ssh remotes", () => {
  assert.equal(repoFromRemote("https://github.com/Sour-Dev-Home/satisfactory-dash.git"), "Sour-Dev-Home/satisfactory-dash");
  assert.equal(repoFromRemote("git@github.com:Sour-Dev-Home/leonardo-nunez-portfolio.git\n"), "Sour-Dev-Home/leonardo-nunez-portfolio");
  assert.equal(repoFromRemote("https://example.com/x/y"), null);
});

test("only the dash auto-merges; the portfolio's live main is the owner's to merge", () => {
  assert.equal(REPOS["Sour-Dev-Home/satisfactory-dash"].autoMerge, true);
  assert.equal(REPOS["Sour-Dev-Home/leonardo-nunez-portfolio"].autoMerge, false);
});

test("globs: * stays in a segment, ** crosses them, a plain string is a substring", () => {
  assert.ok(globToRegExp("desktop/*.png").test("desktop/map.png"));
  assert.ok(!globToRegExp("desktop/*.png").test("desktop/sub/map.png"));
  assert.ok(globToRegExp("**/case-study*").test("tablet-768/case-study-dark.png"));
  assert.ok(globToRegExp("map.png").test("mobile/map.png"));
  assert.ok(!globToRegExp("map.png").test("mobile/mapXpng"));
});

test("selectFiles applies everything by default, or only the matches", () => {
  const all = ["desktop/map.png", "mobile/map.png", "desktop/servers-manage.png"];
  assert.deepEqual(selectFiles(all), all);
  assert.deepEqual(selectFiles(all, ["map.png"]), ["desktop/map.png", "mobile/map.png"]);
  assert.deepEqual(selectFiles(all, ["desktop/*", "nothing"]), ["desktop/map.png", "desktop/servers-manage.png"]);
});

test("pickDispatchedRun takes the newest run started after the dispatch, not an older one", () => {
  const since = Date.parse("2026-10-20T20:00:00Z");
  const runs = [
    { databaseId: 1, createdAt: "2026-10-20T19:00:00Z" },
    { databaseId: 3, createdAt: "2026-10-20T20:00:04Z" },
    { databaseId: 2, createdAt: "2026-10-20T19:59:58Z" },
  ];
  assert.equal(pickDispatchedRun(runs, since).databaseId, 3);
  assert.equal(pickDispatchedRun([runs[0]], since), null);
});

// The forbidden strings are assembled from pieces so that this file doesn't trip the very scan it tests.
const PHRASE = ["hiring", "manager"].join(" ");
const HOME = ["", "ho" + "me", "someone", "x"].join("/");

test("scanDiff flags absolute local paths and the banned phrase on added lines, with file and line", () => {
  const diff = [
    "+++ b/docs/a.md",
    "@@ -1,2 +1,4 @@",
    " context",
    `+see C:${"\\"}Users${"\\"}someone${"\\"}x`,
    `-removed ${["", "c", "Users", "old"].join("/")}`,
    "+fine line",
    `+written for a ${PHRASE}`,
    "+++ b/scripts/b.mjs",
    "@@ -0,0 +7,1 @@",
    `+const p = "${HOME}";`,
  ].join("\n");
  assert.deepEqual(scanDiff(diff), [
    { file: "docs/a.md", line: 2, why: "an absolute Windows user path" },
    { file: "docs/a.md", line: 4, why: `the phrase "${PHRASE}"` },
    { file: "scripts/b.mjs", line: 7, why: "an absolute macOS or Linux home path" },
  ]);
});

test("scanDiff passes relative and placeholder paths", () => {
  assert.deepEqual(scanDiff("+++ b/x\n@@ -0,0 +1,2 @@\n+frontend/e2e/__screenshots__\n+D:\\Games\\FactoryServer.exe"), []);
});

test("blockingStatus ignores only an agent's untracked report file", () => {
  assert.deepEqual(blockingStatus("?? .claude-impl-440.md\n"), []);
  assert.deepEqual(blockingStatus("?? .claude-impl-440.md\n M src/x.ts\n?? notes.md\n"), [" M src/x.ts", "?? notes.md"]);
});

test("parseWorktrees reads paths, branches and locks", () => {
  const out = parseWorktrees(
    ["worktree /r", "HEAD a", "branch refs/heads/main", "", "worktree /r/.claude/worktrees/x", "HEAD b", "branch refs/heads/feat/x", "locked claude agent", "", "worktree /r/.claude/worktrees/y", "HEAD c", "detached", ""].join("\n"),
  );
  assert.deepEqual(out, [
    { path: "/r", branch: "main", locked: false },
    { path: "/r/.claude/worktrees/x", branch: "feat/x", locked: true },
    { path: "/r/.claude/worktrees/y", branch: null, locked: false },
  ]);
});

test("parseArgs: positionals, values, bare flags and repeatable --only", () => {
  assert.deepEqual(parseArgs(["wt", "--only", "a", "--only", "b", "--commit", "msg", "--dry-run"]), {
    _: ["wt"],
    only: ["a", "b"],
    commit: "msg",
    "dry-run": true,
  });
});
