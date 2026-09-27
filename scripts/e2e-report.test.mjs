import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBaselines,
  formatCls,
  parseClsReports,
  parseSnapshots,
  parseSummary,
  runsState,
  stripLogPrefix,
  waitTimeoutMessage,
} from "./e2e-report.mjs";

const run = (name, status = "completed", event = "pull_request") => ({ name, status, event });

test("runs are in once CI and E2E exist and none is still going", () => {
  assert.equal(runsState([run("CI"), run("E2E"), run("CLA")]).done, true);
  assert.deepEqual(runsState([run("CI"), run("E2E", "in_progress")]), { done: false, missing: [], pending: ["E2E"] });
  assert.deepEqual(runsState([run("CLA")]), { done: false, missing: ["CI", "E2E"], pending: [] });
});

test("with --dispatch, an update_snapshots run is needed too", () => {
  const runs = [run("CI"), run("E2E")];
  assert.deepEqual(runsState(runs, { needDispatch: true }).missing, ["E2E (dispatch)"]);
  assert.equal(runsState([...runs, run("E2E", "completed", "workflow_dispatch")], { needDispatch: true }).done, true);
});

test("the timeout says whether the runs never started or are still going", () => {
  const sha = "9bfc8832d174f60da2cdb0a914626571f4a9195a";
  assert.equal(
    waitTimeoutMessage(sha, { missing: ["CI", "E2E"], pending: [] }, 60),
    "no CI, E2E runs for 9bfc883 after 60 min; is the head pushed and the workflow enabled?",
  );
  assert.match(waitTimeoutMessage(sha, { missing: [], pending: ["E2E"] }, 60), /^runs still pending for 9bfc883: E2E after 60 min/);
});

// What `gh run view --log` prints: job, step, timestamp, then the line.
const gh = (line) => `e2e\tRun e2e (compare against committed baselines)\t2026-09-26T20:04:09.5401807Z ${line}`;

test("strips gh's job, step and timestamp prefix, and leaves other lines alone", () => {
  assert.equal(stripLogPrefix(gh("  ✘  34 [desktop] › x")), "  ✘  34 [desktop] › x");
  assert.equal(stripLogPrefix("plain line"), "plain line");
});

test("reads the failed and flaky tests from Playwright's summary, once each", () => {
  const log = [
    "  ✘   34 [desktop] › e2e/states.spec.ts:179:3 › state: default-factory (2.5s)",
    "",
    "  2 failed",
    "    [desktop] › e2e/states.spec.ts:179:3 › state: default-factory ─────────────",
    "    [mobile] › e2e/tab-switch.spec.ts:103:5 › tab switch, motion reduce › stays under CLS 0.02 across the main tabs ──",
    "  1 flaky",
    "    [desktop] › e2e/map.spec.ts:12:3 › map pans ──",
    "  150 passed (3.2m)",
  ]
    .map(gh)
    .join("\n");
  assert.deepEqual(parseSummary(log), {
    failed: [
      "[desktop] › e2e/states.spec.ts:179:3 › state: default-factory",
      "[mobile] › e2e/tab-switch.spec.ts:103:5 › tab switch, motion reduce › stays under CLS 0.02 across the main tabs",
    ],
    flaky: ["[desktop] › e2e/map.spec.ts:12:3 › map pans"],
  });
});

test("a passing run has no failed or flaky tests", () => {
  assert.deepEqual(parseSummary(["  150 passed (3.2m)"].map(gh).join("\n")), { failed: [], flaky: [] });
});

test("survives CRLF line endings", () => {
  const log = ["  1 failed", "    [desktop] › e2e/x.spec.ts:1:1 › a title ───", "  150 passed (3.2m)"].map(gh).join("\r\n");
  assert.deepEqual(parseSummary(log), { failed: ["[desktop] › e2e/x.spec.ts:1:1 › a title"], flaky: [] });
});

test("'1 failed' immediately followed by '1 flaky', with no blank line between sections", () => {
  const log = ["  1 failed", "    [desktop] › e2e/x.spec.ts:1:1 › a ───", "  1 flaky", "    [desktop] › e2e/y.spec.ts:2:2 › b ───"]
    .map(gh)
    .join("\n");
  assert.deepEqual(parseSummary(log), {
    failed: ["[desktop] › e2e/x.spec.ts:1:1 › a"],
    flaky: ["[desktop] › e2e/y.spec.ts:2:2 › b"],
  });
});

test("a 'did not run' / 'interrupted' section between failed and flaky doesn't leak into either list", () => {
  const log = [
    "  1 failed",
    "    [desktop] › e2e/x.spec.ts:1:1 › a ───",
    "  2 did not run",
    "  1 interrupted",
    "  1 flaky",
    "    [desktop] › e2e/z.spec.ts:3:3 › c ───",
  ]
    .map(gh)
    .join("\n");
  assert.deepEqual(parseSummary(log), {
    failed: ["[desktop] › e2e/x.spec.ts:1:1 › a"],
    flaky: ["[desktop] › e2e/z.spec.ts:3:3 › c"],
  });
});

test("a title containing a box-drawing dash mid-string keeps the dash but drops the trailing decoration", () => {
  const log = ["  1 failed", "    [desktop] › e2e/x.spec.ts:1:1 › title with ─ dash inside ───"].map(gh).join("\n");
  assert.deepEqual(parseSummary(log), { failed: ["[desktop] › e2e/x.spec.ts:1:1 › title with ─ dash inside"], flaky: [] });
});

test("a stray interleaved line (another step's output, still gh-prefixed) before the first test in a section doesn't drop it", () => {
  const log = [gh("  2 failed"), gh("some interleaved worker output"), gh("    [desktop] › e2e/x.spec.ts:1:1 › a ───"), gh("    [mobile] › e2e/y.spec.ts:2:2 › b ───")].join(
    "\n",
  );
  assert.deepEqual(parseSummary(log), {
    failed: ["[desktop] › e2e/x.spec.ts:1:1 › a", "[mobile] › e2e/y.spec.ts:2:2 › b"],
    flaky: [],
  });
});

test("a stray interleaved line between two tests in the same section doesn't drop the one after it", () => {
  const log = [gh("  2 failed"), gh("    [desktop] › e2e/x.spec.ts:1:1 › a ───"), gh("some interleaved worker output"), gh("    [mobile] › e2e/y.spec.ts:2:2 › b ───")].join(
    "\n",
  );
  assert.deepEqual(parseSummary(log), {
    failed: ["[desktop] › e2e/x.spec.ts:1:1 › a", "[mobile] › e2e/y.spec.ts:2:2 › b"],
    flaky: [],
  });
});

test("a line lacking the gh prefix entirely, interleaved in a section, doesn't drop the test after it", () => {
  const log = [gh("  1 failed"), "not-a-gh-line raw console output", gh("    [desktop] › e2e/x.spec.ts:1:1 › a ───")].join("\n");
  assert.deepEqual(parseSummary(log), { failed: ["[desktop] › e2e/x.spec.ts:1:1 › a"], flaky: [] });
});

test("lists each differing snapshot once", () => {
  const log = ["Snapshot: default-factory.png", "Snapshot: default-factory.png", "Snapshot: unknown-units.png"].map(gh).join("\n");
  assert.deepEqual(parseSnapshots(log), ["default-factory.png", "unknown-units.png"]);
});

const REPORT = [
  "tab-switch CLS {",
  ' "project": "mobile",',
  ' "motion": "reduce",',
  ' "slowSinceYesterday": false,',
  ' "scores": {',
  '  "Power": 0,',
  '  "Factory": 0.07109004739336493',
  " },",
  ' "timelines": {',
  '  "Power": ["149 ms api /servers/default/status"],',
  '  "Factory": ["370 ms api /servers/default/history/items?range=7d", "376 ms shift 0.0711: footer 779→0"]',
  " }",
  "}",
];

test("parses the multi-line CLS reports out of a prefixed log", () => {
  const log = ["other output", ...REPORT, "  ✓ next test", ...REPORT].map(gh).join("\n");
  const reports = parseClsReports(log);
  assert.equal(reports.length, 2);
  assert.equal(reports[0].project, "mobile");
  assert.equal(reports[0].scores.Factory, 0.07109004739336493);
});

test("skips a report cut short rather than guessing", () => {
  const log = [...REPORT.slice(0, 5), "}", ...REPORT].map(gh).join("\n");
  assert.equal(parseClsReports(log).length, 1);
});

test("survives CRLF line endings", () => {
  const log = REPORT.map(gh).join("\r\n");
  const reports = parseClsReports(log);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].project, "mobile");
});

test("a literal '}' inside a string value, not at the start of a line, doesn't end the report early", () => {
  const withBraceInString = REPORT.map((l) => (l.includes("footer 779") ? l.replace("footer 779→0", "footer 779→0 }") : l));
  const log = withBraceInString.map(gh).join("\n");
  const reports = parseClsReports(log);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].timelines.Factory[1], "376 ms shift 0.0711: footer 779→0 }");
});

test("known limitation: an unindented '}' from unrelated interleaved output inside a report loses that report rather than guessing", () => {
  // Nested closes are indented (" },"), so they don't trigger this; only a stray unindented "}"
  // (e.g. from another concurrently-printing step) does. Documented here as accepted behavior,
  // not fixed: there's no way to tell it apart from the report's own real closing brace.
  const withNoise = [...REPORT.slice(0, 6), "}", ...REPORT.slice(6)];
  const log = withNoise.map(gh).join("\n");
  assert.equal(parseClsReports(log).length, 0);
});

test("prints each variant's scores, and the timeline only for tabs that shifted", () => {
  const lines = formatCls(parseClsReports(REPORT.join("\n")));
  assert.deepEqual(lines, [
    "mobile, motion reduce: Power 0.000 · Factory 0.071",
    "    Factory: 370 ms api /servers/default/history/items?range=7d",
    "    Factory: 376 ms shift 0.0711: footer 779→0",
  ]);
});

test("keeps one line per variant when a retried test prints its report again", () => {
  const retried = REPORT.join("\n").replace("0.07109004739336493", "0.03");
  const lines = formatCls(parseClsReports(`${REPORT.join("\n")}\n${retried}`));
  assert.equal(lines.filter((l) => l.startsWith("mobile, motion reduce")).length, 1);
  assert.equal(lines[0], "mobile, motion reduce: Power 0.000 · Factory 0.030");
});

test("a score of 0 with no timelines entry at all (not just an empty array) prints no timeline lines", () => {
  const r = { project: "desktop", motion: "no-preference", slowSinceYesterday: false, scores: { Power: 0.05 } };
  assert.deepEqual(formatCls([r]), ["desktop, motion no-preference: Power 0.050"]);
});

test("sorts regenerated baselines into new, changed, drift and identical", () => {
  const png = (s) => Buffer.from(s);
  const regenerated = new Map([
    ["desktop/new.png", png("n")],
    ["desktop/same.png", png("s")],
    ["desktop/drift.png", png("d2")],
    ["mobile/changed.png", png("c2")],
  ]);
  const committed = new Map([
    ["desktop/same.png", png("s")],
    ["desktop/drift.png", png("d1")],
    ["mobile/changed.png", png("c1")],
  ]);
  // Stand-in for Playwright's comparator: only "changed" is beyond the threshold.
  const compare = (actual) => (actual.toString() === "c2" ? "18 pixels differ" : null);
  assert.deepEqual(classifyBaselines(regenerated, committed, compare), {
    added: ["desktop/new.png"],
    changed: ["mobile/changed.png"],
    drift: ["desktop/drift.png"],
    identical: ["desktop/same.png"],
  });
});
