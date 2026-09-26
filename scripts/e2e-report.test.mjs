import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBaselines,
  formatCls,
  parseClsReports,
  parseSnapshots,
  parseSummary,
  stripLogPrefix,
} from "./e2e-report.mjs";

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
