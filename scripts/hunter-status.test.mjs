import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BOT_LOGIN,
  decideReuse,
  fetchStatus,
  fingerprint,
  latestStatus,
  OWNER_LOGIN,
  runPost,
  runReuse,
  sessionDescription,
} from "./hunter-status.mjs";

const CONTEXT = "fresh-eyes/test-hunter";
const sha = (c) => c.repeat(40);
const A = sha("a");
const B = sha("b");
const C = sha("c");
const FP = "0123456789ab";

const status = (fields) => ({ context: CONTEXT, state: "success", creator: { login: OWNER_LOGIN }, created_at: "2026-09-27T10:00:00Z", id: 1, ...fields });
const lookup = (bySha) => (s) => bySha[s] ?? null;

// ---- the reuse rule ----

test("an owner success with the same fp is reused, naming the original's full sha", () => {
  const decision = decideReuse({ newFp: FP, beforeSha: A, statusOf: lookup({ [A]: status({ description: `QUICK: 0 bugs fp:${FP}` }) }) });
  assert.deepEqual(decision, { reuse: true, description: `reused from ${A}, fp:${FP}` });
  assert.ok(decision.description.length <= 140);
});

test("a changed fp, a failure, no status, no fp, or another creator is never reused", () => {
  const cases = {
    "changed fp": status({ description: "ok fp:ffffffffffff" }),
    failure: status({ state: "failure", description: `x fp:${FP}` }),
    pending: status({ state: "pending", description: `x fp:${FP}` }),
    "no fp": status({ description: "QUICK: 0 bugs" }),
    "fp not at the end": status({ description: `fp:${FP} and more` }),
    "short fp": status({ description: "x fp:0123456789a" }),
    "another user": status({ creator: { login: "someone-else" }, description: `x fp:${FP}` }),
    "no creator": status({ creator: undefined, description: `x fp:${FP}` }),
  };
  for (const [name, before] of Object.entries(cases)) {
    assert.equal(decideReuse({ newFp: FP, beforeSha: A, statusOf: lookup({ [A]: before }) }).reuse, false, name);
  }
  assert.equal(decideReuse({ newFp: FP, beforeSha: A, statusOf: lookup({}) }).reuse, false, "no status");
});

test("a bot reuse is followed back one hop to an owner-created original with the same fp", () => {
  const statuses = {
    [A]: status({ description: `FULL: 1 bug fixed fp:${FP}` }),
    [B]: status({ creator: { login: BOT_LOGIN }, description: `reused from ${A}, fp:${FP}` }),
  };
  assert.deepEqual(decideReuse({ newFp: FP, beforeSha: B, statusOf: lookup(statuses) }), {
    reuse: true,
    description: `reused from ${A}, fp:${FP}`,
  });
});

test("a bot status naming an original without a matching owner success is not reused", () => {
  const bot = (description) => status({ creator: { login: BOT_LOGIN }, description });
  const cases = {
    "original has no status": [{}, bot(`reused from ${A}, fp:${FP}`)],
    "original has a different fp": [{ [A]: status({ description: "x fp:ffffffffffff" }) }, bot(`reused from ${A}, fp:${FP}`)],
    "original failed": [{ [A]: status({ state: "failure", description: `x fp:${FP}` }) }, bot(`reused from ${A}, fp:${FP}`)],
    "original was posted by the bot": [
      { [A]: status({ creator: { login: BOT_LOGIN }, description: `x fp:${FP}` }) },
      bot(`reused from ${A}, fp:${FP}`),
    ],
    "no original named": [{ [A]: status({ description: `x fp:${FP}` }) }, bot(`looks fine fp:${FP}`)],
    "short sha named": [{ [A]: status({ description: `x fp:${FP}` }) }, bot(`reused from aaaaaaa, fp:${FP}`)],
  };
  for (const [name, [others, before]] of Object.entries(cases)) {
    assert.equal(decideReuse({ newFp: FP, beforeSha: B, statusOf: lookup({ ...others, [B]: before }) }).reuse, false, name);
  }
});

test("latestStatus takes the newest fresh-eyes status and ignores other contexts", () => {
  const list = [
    { context: "ci", state: "success", created_at: "2026-09-27T12:00:00Z" },
    status({ state: "success", created_at: "2026-09-27T10:00:00Z", id: 1 }),
    status({ state: "failure", created_at: "2026-09-27T11:00:00Z", id: 2 }),
    null,
  ];
  assert.equal(latestStatus(list).state, "failure");
  assert.equal(latestStatus([status({ state: "failure", id: 1 }), status({ state: "success", id: 2 })]).state, "success");
  assert.equal(latestStatus("nope"), null);
});

test("fetchStatus reads every page of the list endpoint", () => {
  const calls = [];
  const page1 = Array.from({ length: 100 }, (_, i) => ({ context: "other", id: i }));
  const page2 = [status({ description: "late page" })];
  const api = (args) => {
    calls.push(args[0]);
    return JSON.stringify(args[0].endsWith("page=1") ? page1 : page2);
  };
  assert.equal(fetchStatus({ repo: "o/r", sha: A }, api).description, "late page");
  assert.deepEqual(calls, [`repos/o/r/commits/${A}/statuses?per_page=100&page=1`, `repos/o/r/commits/${A}/statuses?per_page=100&page=2`]);
});

test("sessionDescription appends the fp and refuses an empty or too-long summary", () => {
  assert.equal(sessionDescription("  QUICK: 0 bugs ", FP), `QUICK: 0 bugs fp:${FP}`);
  assert.throws(() => sessionDescription(" ", FP), /one-line summary/);
  assert.equal(sessionDescription("x".repeat(124), FP).length, 140);
  assert.throws(() => sessionDescription("x".repeat(125), FP), /141 characters/);
});

// ---- the fingerprint, on a real repository ----

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "hunter-status-test-"));
  const gitRun = (args, input) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    });
  const write = (name, text) => writeFileSync(path.join(dir, name), text);
  const commit = (message) => {
    gitRun(["add", "-A"]);
    gitRun(["commit", "-q", "-m", message]);
    return gitRun(["rev-parse", "HEAD"]).trim();
  };
  gitRun(["init", "-q", "-b", "main"]);
  write("app.js", "const a = 1;\nconst b = 2;\n");
  write("other.js", "export const x = 1;\n");
  commit("base");
  return { dir, gitRun, write, commit, fp: (head) => fingerprint({ base: "main", head }, gitRun) };
}

test("fingerprint: a rebase onto a newer main and a merge from main keep it; a change or whitespace doesn't", () => {
  const r = repo();
  try {
    r.gitRun(["switch", "-q", "-c", "pr"]);
    r.write("app.js", "const a = 1;\nconst b = y - -z;\n");
    const prHead = r.commit("pr change");
    const original = r.fp(prHead);
    assert.match(original, /^[0-9a-f]{12}$/);

    // main moves on elsewhere
    r.gitRun(["switch", "-q", "main"]);
    r.write("other.js", "export const x = 2;\n");
    r.commit("main moves");

    // merge from main: same fp
    r.gitRun(["switch", "-q", "pr"]);
    r.gitRun(["merge", "-q", "--no-edit", "main"]);
    assert.equal(r.fp("HEAD"), original, "merge from main");

    // rebase onto the newer main: same fp
    r.gitRun(["switch", "-q", "-c", "rebased", prHead]);
    r.gitRun(["rebase", "-q", "main"]);
    assert.equal(r.fp("HEAD"), original, "rebase");

    // a one-line code change: different
    r.write("app.js", "const a = 1;\nconst b = y - -w;\n");
    assert.notEqual(r.fp(r.commit("one line")), original, "one-line change");

    // whitespace that changes meaning: `y - -z` vs `y --z` must differ (plain patch-id would match)
    r.gitRun(["switch", "-q", "-c", "ws", prHead]);
    r.write("app.js", "const a = 1;\nconst b = y --z;\n");
    assert.notEqual(r.fp(r.commit("whitespace")), original, "whitespace-only change");
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("fingerprint: two different binary edits differ, and a PR with no changes throws", () => {
  const r = repo();
  try {
    r.gitRun(["switch", "-q", "-c", "one"]);
    writeFileSync(path.join(r.dir, "img.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    const one = r.fp(r.commit("bin one"));
    r.gitRun(["switch", "-q", "-c", "two", "main"]);
    writeFileSync(path.join(r.dir, "img.bin"), Buffer.from([0, 1, 2, 4, 0, 255]));
    assert.notEqual(r.fp(r.commit("bin two")), one);
    assert.throws(() => r.fp("main"), /no changes of its own/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

// ---- the two entry points, with git and the API faked ----

const env = { REPO: "o/r", PR_NUMBER: "12", BEFORE: A, AFTER: B, BASE_SHA: C };

function fakeGit({ head = B, fp = FP } = {}) {
  const calls = [];
  const gitRun = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "rev-parse") return `${head}\n`;
    if (args[0] === "merge-base") return `${C}\n`;
    if (args[0] === "diff") return "diff --git a/x b/x\n";
    if (args[0] === "patch-id") return `${fp}${"0".repeat(28)} ${"0".repeat(40)}\n`;
    if (args[0] === "status") return "";
    return "";
  };
  return { gitRun, calls };
}

function fakeApi(bySha) {
  const posts = [];
  const api = (args) => {
    if (args[0].includes("/statuses/")) {
      posts.push(args);
      return "{}";
    }
    const s = /commits\/([0-9a-f]{40})\/statuses/.exec(args[0])[1];
    return JSON.stringify(bySha[s] ? [bySha[s]] : []);
  };
  return { api, posts };
}

test("runReuse fetches the head as objects only, and posts a reuse on the new head", () => {
  const { gitRun, calls } = fakeGit();
  const { api, posts } = fakeApi({ [A]: status({ description: `ok fp:${FP}` }) });
  assert.equal(runReuse(env, { api, gitRun }).reuse, true);
  assert.equal(calls[0], "fetch --no-tags --quiet origin +refs/pull/12/head:refs/remotes/pr/head");
  assert.ok(!calls.some((c) => /^(checkout|switch|reset|restore)\b/.test(c)), "never checks the PR out");
  assert.equal(calls.find((c) => c.startsWith("merge-base")), `merge-base ${C} ${B}`);
  assert.deepEqual(posts, [[`repos/o/r/statuses/${B}`, "-f", "state=success", "-f", `context=${CONTEXT}`, "-f", `description=reused from ${A}, fp:${FP}`]]);
});

test("runReuse posts nothing when the fp differs or the head moved on", () => {
  const differs = fakeApi({ [A]: status({ description: "ok fp:ffffffffffff" }) });
  assert.equal(runReuse(env, { api: differs.api, gitRun: fakeGit().gitRun }).reuse, false);
  assert.deepEqual(differs.posts, []);

  const moved = fakeApi({ [A]: status({ description: `ok fp:${FP}` }) });
  const decision = runReuse(env, { api: moved.api, gitRun: fakeGit({ head: C }).gitRun });
  assert.match(decision.reason, /moved on/);
  assert.deepEqual(moved.posts, []);
});

test("runReuse refuses malformed input before running anything", () => {
  const { gitRun, calls } = fakeGit();
  for (const bad of [{ REPO: "o r" }, { PR_NUMBER: "12; rm" }, { PR_NUMBER: "0" }, { BEFORE: "abc" }, { AFTER: undefined }, { BASE_SHA: A.toUpperCase() }]) {
    assert.throws(() => runReuse({ ...env, ...bad }, { api: () => "[]", gitRun }), /missing or malformed/);
  }
  assert.deepEqual(calls, []);
});

test("runPost posts summary and fp on the pushed PR head, and refuses a dirty tree or an unpushed head", () => {
  const { gitRun } = fakeGit({ head: B });
  const { api, posts } = fakeApi({});
  const gh = (args) => JSON.stringify(args[0] === "repo" ? { nameWithOwner: "o/r" } : { headRefOid: B, state: "OPEN" });
  assert.deepEqual(runPost("QUICK: 0 bugs", { api, gitRun, gh }), { sha: B, description: `QUICK: 0 bugs fp:${FP}` });
  assert.equal(posts[0][0], `repos/o/r/statuses/${B}`);

  const dirty = (args) => (args[0] === "status" ? " M x\n" : gitRun(args));
  assert.throws(() => runPost("x", { api, gitRun: dirty, gh }), /commit or discard/);
  const unpushed = (args) => JSON.stringify(args[0] === "repo" ? { nameWithOwner: "o/r" } : { headRefOid: C, state: "OPEN" });
  assert.throws(() => runPost("x", { api, gitRun, gh: unpushed }), /push first/);
  const closed = (args) => JSON.stringify({ headRefOid: B, state: "MERGED" });
  assert.throws(() => runPost("x", { api, gitRun, gh: closed }), /isn't open/);
  assert.equal(posts.length, 1);
});
