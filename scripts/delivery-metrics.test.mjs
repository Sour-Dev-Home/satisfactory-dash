import { test } from "node:test";
import assert from "node:assert/strict";
import { DeliverySnapshotSchema } from "../packages/shared/src/metrics.ts";
import {
  SCHEMA_VERSION, bounceStats, buildReport, failedRequiredCheckTimes, flakeStats, normalizePr, normalizeRun, parseArgs, parseGraphql,
  percentile, renderMarkdown, requiredCheckNames, weekStart,
} from "./delivery-metrics.mjs";

const NOW = new Date("2026-09-27T12:00:00Z");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

// A GraphQL node as the API returns it, with the personal fields a careless script could copy through.
const node = (overrides = {}) => ({
  createdAt: "2026-09-26T00:00:00Z",
  mergedAt: "2026-09-26T04:00:00Z",
  updatedAt: "2026-09-26T04:00:00Z",
  additions: 10,
  deletions: 5,
  title: "feat: something private-title-marker",
  author: { login: "octo-person", email: "person@example.invalid", name: "Real Name" },
  headRefName: "feat/private-branch-marker",
  body: "secret-body-marker",
  commits: { nodes: [{ commit: { oid: SHA_A, message: "private-commit-marker", author: { name: "Real Name" } } }] },
  ...overrides,
});

// A `gh run list` row, with the strings the normaliser must drop.
const runRow = (overrides = {}) => ({
  attempt: 1,
  conclusion: "success",
  createdAt: "2026-09-26T00:00:00Z",
  startedAt: "2026-09-26T00:00:00Z",
  databaseId: 1,
  headSha: SHA_A,
  event: "pull_request",
  headBranch: "feat/private-branch-marker",
  displayTitle: "private-title-marker",
  ...overrides,
});
const ciRun = (overrides = {}, workflow = "ci.yml", earlier = []) => normalizeRun(runRow(overrides), workflow, earlier);
const attempt = (n, conclusion, at) => ({ run_attempt: n, conclusion, run_started_at: at, actor: { login: "octo-person" } });

const report = (nodes, extra = {}) =>
  buildReport({ prs: nodes.map(normalizePr), ciRuns: [], fragmentDates: [], now: NOW, days: 30, ...extra });

test("percentile interpolates and handles empty and single values", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([7], 0.9), 7);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([10, 0, 5], 0.5), 5);
});

test("weekStart is the Monday 00:00 UTC of the week", () => {
  assert.equal(weekStart("2026-09-27T12:00:00Z"), "2026-09-21T00:00:00.000Z"); // a Sunday
  assert.equal(weekStart("2026-09-21T00:00:00Z"), "2026-09-21T00:00:00.000Z"); // the Monday itself
});

test("throughput, lead time and size are computed from the merged PRs in the window only", () => {
  const r = report([
    node(), // 4 h, 15 lines
    node({ createdAt: "2026-09-25T00:00:00Z", mergedAt: "2026-09-25T10:00:00Z", additions: 100, deletions: 0 }), // 10 h, 100 lines
    node({ mergedAt: "2026-07-01T00:00:00Z", createdAt: "2026-06-30T00:00:00Z" }), // outside the 30-day window
  ]);
  assert.equal(r.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.throughput.mergedPrs, 2);
  assert.equal(r.throughput.perDay, 0.07);
  assert.deepEqual(r.throughput.perWeek, [{ weekStart: "2026-09-21T00:00:00.000Z", merged: 2 }]);
  assert.equal(r.leadTimeHours.median, 7);
  assert.equal(r.leadTimeHours.mean, 7);
  assert.equal(r.size.medianLinesChanged, 57.5);
});

test("an empty window gives nulls, not NaN or a crash, and still parses", () => {
  const r = report([]);
  assert.equal(r.throughput.mergedPrs, 0);
  assert.equal(r.leadTimeHours.median, null);
  assert.equal(r.size.medianLinesChanged, null);
  assert.equal(r.changeFailure.failureRate, null);
  assert.deepEqual(r.ci, { mainRuns: 0, failedMainRuns: 0, mainFailureRate: null, flakyRuns: 0, flakeRate: null, prsMerged: 0, prsBounced: 0, bounceRate: null });
  assert.match(renderMarkdown(r), /n\/a/);
  assert.equal(DeliverySnapshotSchema.safeParse(r).success, true);
});

test("schemaVersion 2: the mergeQueue section is gone and a ci section exists", () => {
  const r = report([node()]);
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal("mergeQueue" in r, false);
  assert.deepEqual(Object.keys(r), ["schemaVersion", "generatedAt", "window", "throughput", "leadTimeHours", "size", "changeFailure", "ci", "logFragments"]);
});

test("change failure and ci main runs: ci.yml pushes to main, cancelled, skipped, running and other runs ignored", () => {
  const main = { event: "push", headBranch: "main" };
  const ciRuns = [
    ciRun({ ...main, conclusion: "success", createdAt: "2026-09-26T00:00:00Z" }),
    ciRun({ ...main, conclusion: "failure", createdAt: "2026-09-26T01:00:00Z", headSha: SHA_B }),
    ciRun({ ...main, conclusion: "cancelled", createdAt: "2026-09-26T02:00:00Z" }),
    ciRun({ ...main, conclusion: "skipped", createdAt: "2026-09-26T02:30:00Z" }),
    ciRun({ ...main, conclusion: "success", createdAt: "2026-01-01T00:00:00Z" }), // outside the window
    ciRun({ ...main, conclusion: "", createdAt: "2026-09-26T03:00:00Z" }), // still running
    ciRun({ ...main, conclusion: "failure", createdAt: "2026-09-26T04:00:00Z" }, "e2e.yml"), // not ci.yml
    ciRun({ event: "push", headBranch: "feat/x", conclusion: "failure", createdAt: "2026-09-26T05:00:00Z" }), // not main
    ciRun({ event: "pull_request", headBranch: "main", conclusion: "failure", createdAt: "2026-09-26T06:00:00Z" }), // not a push
  ];
  const r = report([node({ title: "Revert \"feat: x\"" }), node()], { ciRuns });
  assert.equal(r.changeFailure.mainRuns, 2);
  assert.equal(r.changeFailure.failedMainRuns, 1);
  assert.equal(r.changeFailure.failureRate, 0.5);
  assert.equal(r.changeFailure.revertPrs, 1);
  assert.equal(r.changeFailure.revertRate, 0.5);
  assert.equal(r.ci.mainRuns, 2);
  assert.equal(r.ci.failedMainRuns, 1);
  assert.equal(r.ci.mainFailureRate, 0.5);
});

test("normalizeRun keeps the attempts in order, reduces the branch to a boolean and drops every other string", () => {
  const run = normalizeRun(
    runRow({ attempt: 3, conclusion: "success", startedAt: "2026-09-26T02:00:00Z", event: "push", headBranch: "main" }),
    "ci.yml",
    [attempt(2, "failure", "2026-09-26T01:00:00Z"), attempt(1, "failure", "2026-09-26T00:00:00Z"), attempt(3, "failure", "2026-09-26T09:00:00Z")],
  );
  assert.deepEqual(Object.keys(run).sort(), ["attempts", "conclusion", "createdAt", "onMainPush", "sha", "workflow"]);
  assert.equal(run.onMainPush, true);
  // the attempt equal to the latest is ignored: the run list row is the source for the latest attempt
  assert.deepEqual(run.attempts.map((a) => [a.n, a.conclusion]), [[1, "failure"], [2, "failure"], [3, "success"]]);
  assert.equal(JSON.stringify(run).includes("private"), false);
  assert.equal(JSON.stringify(run).includes("octo-person"), false);
});

// ADR-0056 section 4, line 94: "a flaky run is a CI run whose head SHA has a failed attempt and a later successful attempt".
test("flake: a run rerun green after a failed attempt is flaky", () => {
  const rerun = ciRun({ attempt: 2, conclusion: "success", startedAt: "2026-09-26T01:00:00Z" }, "ci.yml", [attempt(1, "failure", "2026-09-26T00:00:00Z")]);
  const green = ciRun({ headSha: SHA_B });
  assert.deepEqual(flakeStats([rerun, green]), { runs: 2, flaky: 1 });
});

test("flake: a new green run on the same SHA after a failed run counts once, on the green run", () => {
  const failed = ciRun({ conclusion: "failure", startedAt: "2026-09-26T00:00:00Z" });
  const green = ciRun({ databaseId: 2, conclusion: "success", startedAt: "2026-09-26T01:00:00Z" });
  const greenAgain = ciRun({ databaseId: 3, conclusion: "success", startedAt: "2026-09-26T02:00:00Z" });
  assert.deepEqual(flakeStats([failed, green, greenAgain]), { runs: 3, flaky: 1 });
});

test("flake: not flaky when the failure came after the success, stayed red, or was on another SHA or workflow", () => {
  const greenThenRed = [ciRun({ startedAt: "2026-09-26T00:00:00Z" }), ciRun({ conclusion: "failure", startedAt: "2026-09-26T01:00:00Z" })];
  assert.deepEqual(flakeStats(greenThenRed), { runs: 2, flaky: 0 });
  const stayedRed = ciRun({ attempt: 2, conclusion: "failure" }, "ci.yml", [attempt(1, "failure", "2026-09-25T23:00:00Z")]);
  assert.deepEqual(flakeStats([stayedRed]), { runs: 1, flaky: 0 });
  const otherSha = [ciRun({ conclusion: "failure", startedAt: "2026-09-26T00:00:00Z" }), ciRun({ headSha: SHA_B, startedAt: "2026-09-26T01:00:00Z" })];
  assert.deepEqual(flakeStats(otherSha), { runs: 2, flaky: 0 });
  const otherWorkflow = [ciRun({ conclusion: "failure", startedAt: "2026-09-26T00:00:00Z" }), ciRun({ startedAt: "2026-09-26T01:00:00Z" }, "e2e.yml")];
  assert.deepEqual(flakeStats(otherWorkflow), { runs: 2, flaky: 0 });
});

test("flake: cancelled attempts are not failures, and cancelled or running runs are not in the denominator", () => {
  const cancelledThenGreen = ciRun({ attempt: 2, conclusion: "success" }, "ci.yml", [attempt(1, "cancelled", "2026-09-25T23:00:00Z")]);
  const cancelled = ciRun({ headSha: SHA_B, conclusion: "cancelled" });
  const running = ciRun({ headSha: SHA_C, conclusion: "" });
  assert.deepEqual(flakeStats([cancelledThenGreen, cancelled, running]), { runs: 1, flaky: 0 });
  const timedOutThenGreen = ciRun({ attempt: 2, conclusion: "success" }, "ci.yml", [attempt(1, "timed_out", "2026-09-25T23:00:00Z")]);
  assert.deepEqual(flakeStats([timedOutThenGreen]), { runs: 1, flaky: 1 });
});

test("flake: runs without a SHA stand alone and never pair up; an empty list is zero", () => {
  const failed = ciRun({ headSha: undefined, conclusion: "failure", startedAt: "2026-09-26T00:00:00Z" });
  const green = ciRun({ headSha: undefined, startedAt: "2026-09-26T01:00:00Z" });
  assert.deepEqual(flakeStats([failed, green]), { runs: 2, flaky: 0 });
  assert.deepEqual(flakeStats([]), { runs: 0, flaky: 0 });
});

test("bounce: a check that failed exactly at the merge instant did not happen before it", () => {
  const prs = [normalizePr(node({ commits: { nodes: [{ commit: { oid: SHA_B } }] } }))];
  assert.deepEqual(bounceStats(prs, new Map([[SHA_B, ["2026-09-26T04:00:00Z"]]])), { merged: 1, bounced: 0 });
  assert.deepEqual(bounceStats(prs, new Map([[SHA_B, ["2026-09-26T03:59:59Z"]]])), { merged: 1, bounced: 1 });
});

test("flake rate in the report covers only runs created in the window", () => {
  const rerun = (createdAt) => ciRun({ attempt: 2, createdAt, startedAt: createdAt }, "e2e.yml", [attempt(1, "failure", "2026-01-01T00:00:00Z")]);
  const r = report([], { ciRuns: [rerun("2026-09-26T00:00:00Z"), rerun("2026-01-02T00:00:00Z"), ciRun({ headSha: SHA_B }), ciRun({ headSha: SHA_C })] });
  assert.equal(r.ci.flakyRuns, 1);
  assert.equal(r.ci.flakeRate, 0.333);
});

// ADR-0056 section 4, line 95: "a bounced PR is a merged PR whose required checks failed at least once before the merge".
test("bounce: a required check failure on any of the PR's commits before the merge bounces it", () => {
  const prs = [
    node({ commits: { nodes: [{ commit: { oid: SHA_B } }, { commit: { oid: SHA_A } }] } }), // SHA_B failed before the merge
    node({ commits: { nodes: [{ commit: { oid: SHA_C } }] } }), // SHA_C failed only after the merge
    node(), // SHA_A: no failure
  ].map(normalizePr);
  const failedChecks = new Map([[SHA_B, ["2026-09-26T01:00:00Z"]], [SHA_C, ["2026-09-26T05:00:00Z"]]]);
  assert.deepEqual(bounceStats(prs, failedChecks), { merged: 3, bounced: 1 });
  const r = buildReport({ prs, ciRuns: [], failedChecks, fragmentDates: [], now: NOW, days: 30 });
  assert.equal(r.ci.prsMerged, 3);
  assert.equal(r.ci.prsBounced, 1);
  assert.equal(r.ci.bounceRate, 0.333);
});

test("bounce: a PR merged outside the window is not counted, and nothing merged gives a null rate", () => {
  const old = node({ mergedAt: "2026-07-01T00:00:00Z", createdAt: "2026-06-30T00:00:00Z", commits: { nodes: [{ commit: { oid: SHA_B } }] } });
  const r = report([old], { failedChecks: new Map([[SHA_B, ["2026-06-30T01:00:00Z"]]]) });
  assert.equal(r.ci.prsMerged, 0);
  assert.equal(r.ci.prsBounced, 0);
  assert.equal(r.ci.bounceRate, null);
});

test("requiredCheckNames reads the required_status_checks rule and nothing else", () => {
  const rules = [
    { type: "deletion" },
    { type: "required_status_checks", parameters: { required_status_checks: [{ context: "verify" }, { context: "security" }, { context: "e2e" }, { context: 7 }] } },
  ];
  assert.deepEqual(requiredCheckNames(rules), ["e2e", "security", "verify"]);
  assert.deepEqual(requiredCheckNames([]), []);
  assert.throws(() => requiredCheckNames({ message: "secret@example.com" }), (error) => !/secret/.test(error.message));
});

test("failedRequiredCheckTimes keeps only failed required checks, across pages, as sorted times", () => {
  const pages = [
    { check_runs: [
      { name: "verify", conclusion: "failure", completed_at: "2026-09-26T02:00:00Z" },
      { name: "verify", conclusion: "success", completed_at: "2026-09-26T03:00:00Z" },
      { name: "lint-extra", conclusion: "failure", completed_at: "2026-09-26T00:30:00Z" }, // not required
      { name: "e2e", conclusion: "cancelled", completed_at: "2026-09-26T00:40:00Z" }, // not a failure
    ] },
    { check_runs: [{ name: "e2e", conclusion: "timed_out", completed_at: "2026-09-26T01:00:00Z" }, { name: "security", conclusion: "failure", completed_at: null }] },
  ];
  assert.deepEqual(failedRequiredCheckTimes(pages, ["e2e", "security", "verify"]), ["2026-09-26T01:00:00Z", "2026-09-26T02:00:00Z"]);
  assert.throws(() => failedRequiredCheckTimes({ check_runs: [] }, ["verify"]), /unexpected/);
});

test("log fragments are counted by the date in their file name, inside the window", () => {
  const r = report([], { fragmentDates: ["2026-09-26", "2026-09-27", "2026-08-01"] });
  assert.equal(r.logFragments.inWindow, 2);
});

// A fixture covering every section with non-trivial values, as the ingest endpoint (ADR-0056 PR 6b) will receive it.
function fullFixture() {
  const prs = [
    node({ commits: { nodes: [{ commit: { oid: SHA_B } }] } }),
    node({ title: "Revert private-title-marker", createdAt: "2026-09-20T00:00:00Z", mergedAt: "2026-09-21T06:00:00Z" }),
  ].map(normalizePr);
  const ciRuns = [
    ciRun({ event: "push", headBranch: "main", conclusion: "failure", headSha: SHA_C }),
    ciRun({ event: "push", headBranch: "main", headSha: SHA_A }),
    ciRun({ attempt: 2, headSha: SHA_B, startedAt: "2026-09-26T01:00:00Z" }, "e2e.yml", [attempt(1, "failure", "2026-09-26T00:30:00Z")]),
  ];
  const failedChecks = new Map([[SHA_B, ["2026-09-26T00:50:00Z"]]]);
  return buildReport({ prs, ciRuns, failedChecks, fragmentDates: ["2026-09-26"], now: NOW, days: 30 });
}

test("the output parses with the shared ingest schema (DeliverySnapshotSchema)", () => {
  const r = fullFixture();
  const parsed = DeliverySnapshotSchema.safeParse(r);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.deepEqual(r.ci, { mainRuns: 2, failedMainRuns: 1, mainFailureRate: 0.5, flakyRuns: 1, flakeRate: 0.333, prsMerged: 2, prsBounced: 1, bounceRate: 0.5 });
  // the strict schema refuses the old v1 shape
  assert.equal(DeliverySnapshotSchema.safeParse({ ...r, schemaVersion: 1 }).success, false);
  assert.equal(DeliverySnapshotSchema.safeParse({ ...r, mergeQueue: {} }).success, false);
});

test("the output is deterministic: the same input gives byte-identical JSON and markdown", () => {
  assert.equal(JSON.stringify(fullFixture()), JSON.stringify(fullFixture()));
  assert.equal(renderMarkdown(fullFixture()), renderMarkdown(fullFixture()));
});

// The privacy guarantee (#280, ADR-0056 line 96): aggregates only. The input carries a login, an email, a real name, a
// title, a branch, a body, a commit message and SHAs; none of them, and no key that could hold one, may appear in the output.
const ALLOWED_KEYS = new Set([
  "schemaVersion", "generatedAt", "window", "days", "from", "to", "throughput", "mergedPrs", "perDay", "perWeek", "weekStart", "merged",
  "leadTimeHours", "median", "p90", "mean", "size", "medianLinesChanged", "changeFailure", "mainRuns", "failedMainRuns", "failureRate",
  "revertPrs", "revertRate", "ci", "mainFailureRate", "flakyRuns", "flakeRate", "prsMerged", "prsBounced", "bounceRate", "logFragments", "inWindow",
]);

function keysOf(value, out = []) {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, out));
  else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      out.push(key);
      keysOf(inner, out);
    }
  }
  return out;
}

test("the report holds aggregates only: no author, login, email, name, title, branch, body, message or SHA", () => {
  const r = fullFixture();
  const text = JSON.stringify(r) + renderMarkdown(r);
  for (const marker of ["octo-person", "person@example.invalid", "Real Name", "private-title-marker", "private-branch-marker", "secret-body-marker", "private-commit-marker", "feat/", SHA_A, SHA_B, SHA_C, "aaaaaaa"]) {
    assert.equal(text.includes(marker), false, marker);
  }
  assert.deepEqual(keysOf(r).filter((key) => !ALLOWED_KEYS.has(key)), []);
  assert.equal(keysOf(r).some((key) => /login|email|author|title|name|body|message|user|sha|url|branch|commit/i.test(key)), false);
});

test("normalizePr keeps only numbers, dates, a boolean and valid commit SHAs, and skips nodes that did not merge", () => {
  const normalized = normalizePr(node({ title: "Revert x", commits: { nodes: [{ commit: { oid: SHA_A } }, { commit: { oid: "not-a-sha" } }, {}] } }));
  assert.deepEqual(Object.keys(normalized).sort(), ["commitShas", "createdAt", "isRevert", "linesChanged", "mergedAt"]);
  assert.equal(normalized.isRevert, true);
  assert.deepEqual(normalized.commitShas, [SHA_A]);
  assert.deepEqual(normalizePr(node({ commits: undefined })).commitShas, []);
  assert.equal(normalizePr({ createdAt: "2026-09-26T00:00:00Z", mergedAt: null }), undefined);
  assert.equal(normalizePr(null), undefined);
});

test("parseArgs takes --days, --json and --out and rejects anything else", () => {
  assert.deepEqual(parseArgs([]), { days: 30, json: false, out: undefined });
  assert.deepEqual(parseArgs(["--days", "7", "--json", "--out", "x"]), { days: 7, json: true, out: "x" });
  assert.throws(() => parseArgs(["--days", "0"]), /--days/);
  assert.throws(() => parseArgs(["--days", "abc"]), /--days/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
});

test("parseArgs rejects a missing value, hex, decimals and a flag swallowed as a value", () => {
  assert.throws(() => parseArgs(["--days"]), /--days/);
  assert.throws(() => parseArgs(["--days", "0x10"]), /--days/);
  assert.throws(() => parseArgs(["--days", "1.5"]), /--days/);
  assert.throws(() => parseArgs(["--days", "366"]), /--days/);
  assert.throws(() => parseArgs(["--days", "--json"]), /--days/);
  assert.throws(() => parseArgs(["--out"]), /--out/);
  assert.throws(() => parseArgs(["--out", "--json"]), /--out/);
});

test("parseGraphql never echoes raw API text in an error", () => {
  assert.throws(() => parseGraphql("secret@example.com not json"), (error) => !/secret/.test(error.message));
  assert.throws(() => parseGraphql(JSON.stringify({ errors: [{ message: "secret@example.com" }] })), (error) => !/secret/.test(error.message));
  const page = { nodes: [], pageInfo: { hasNextPage: false } };
  assert.equal(parseGraphql(JSON.stringify({ data: { repository: { pullRequests: page } } })).nodes.length, 0);
});
