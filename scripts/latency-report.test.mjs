import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DAYS, aggregate, formatReport, parseRequestLine, percentile, selectLogFiles } from "./latency-report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "latency-sample.log");
const fixtureLines = () => readFileSync(FIXTURE, "utf8").split("\n");

test("percentile is the nearest rank of an ascending list", () => {
  const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(ten, 50), 50);
  assert.equal(percentile(ten, 95), 100);
  assert.equal(percentile(ten, 99), 100);
  assert.equal(percentile(ten, 10), 10);
  assert.equal(percentile([7], 50), 7);
  assert.equal(percentile([7], 99), 7);
  assert.equal(percentile([], 50), undefined);
});

test("on the fixture log: p50, p95 and p99 per route, exactly", () => {
  const result = aggregate(fixtureLines());
  assert.equal(result.requests, 11);
  // The start-up line, the poller's line, the non-JSON line, and the line whose responseTime is not a number.
  assert.equal(result.skipped, 4);
  const route = (key) => result.routes.find((r) => r.route === key);

  const status = route("GET /api/servers/:serverId/status");
  assert.deepEqual(status.total, { n: 5, p50: 60, p95: 100, p99: 100 });
  assert.deepEqual(status.app, { n: 5, p50: 6, p95: 10, p99: 10 });
  assert.deepEqual(status.upstream, { n: 5, p50: 54, p95: 90, p99: 90 });
  assert.equal(status.failed, 0);

  const factory = route("GET /api/servers/:serverId/factory");
  assert.deepEqual(factory.total, { n: 3, p50: 400, p95: 600, p99: 600 });
  assert.deepEqual(factory.app, { n: 3, p50: 40, p95: 60, p99: 60 });
  assert.deepEqual(factory.upstream, { n: 3, p50: 360, p95: 540, p99: 540 });
  assert.equal(factory.failed, 1); // the 503

  const health = route("GET /api/health/ready");
  assert.deepEqual(health.total, { n: 2, p50: 1, p95: 3, p99: 3 });
  assert.deepEqual(health.upstream, { n: 2, p50: 0, p95: 0, p99: 0 });
});

test("a line from before the split counts in the total only, and a request no route handled is (unmatched)", () => {
  const unmatched = aggregate(fixtureLines()).routes.find((r) => r.route === "GET (unmatched)");
  assert.deepEqual(unmatched.total, { n: 1, p50: 5, p95: 5, p99: 5 });
  assert.deepEqual(unmatched.app, { n: 0, p50: undefined, p95: undefined, p99: undefined });
});

test("per game-server API: only the requests that waited on it, vanilla and frm apart", () => {
  const { upstreams } = aggregate(fixtureLines());
  const [vanilla, frm] = upstreams;
  assert.equal(vanilla.upstream, "vanilla");
  // 18 36 54 72 90 (status) and 50 100 150 (factory), 8 requests; the two health checks used no upstream.
  assert.deepEqual({ n: vanilla.n, p50: vanilla.p50, p95: vanilla.p95, p99: vanilla.p99 }, { n: 8, p50: 54, p95: 150, p99: 150 });
  assert.equal(frm.upstream, "frm");
  assert.deepEqual({ n: frm.n, p50: frm.p50, p95: frm.p95, p99: frm.p99 }, { n: 3, p50: 300, p95: 390, p99: 390 });
});

test("routes come slowest p95 first, and the route pattern (not the URL) is what is grouped", () => {
  const { routes } = aggregate(fixtureLines());
  assert.deepEqual(routes.map((r) => r.route), [
    "GET /api/servers/:serverId/factory",
    "GET /api/servers/:serverId/status",
    "GET (unmatched)", // p95 5 ms
    "GET /api/health/ready", // p95 3 ms
  ]);
});

test("parseRequestLine keeps only durations and the route: nothing from the URL, no address, no user", () => {
  const record = parseRequestLine(fixtureLines()[3]); // the status line whose URL has a query string
  assert.equal(record.key, "GET /api/servers/:serverId/status");
  assert.equal(JSON.stringify(record).includes("bravo"), false);
  assert.equal(JSON.stringify(record).includes("x=1"), false);
});

test("parseRequestLine skips what is not a request line", () => {
  assert.equal(parseRequestLine("not json"), undefined);
  assert.equal(parseRequestLine("null"), undefined);
  assert.equal(parseRequestLine('{"msg":"hello"}'), undefined);
  assert.equal(parseRequestLine('{"responseTime":-1}'), undefined);
  assert.equal(parseRequestLine('{"responseTime":"12"}'), undefined);
  assert.equal(parseRequestLine('{"responseTime":null}'), undefined);
});

test("a half-filled split (appMs without upstreamMs) is treated as no split rather than guessed", () => {
  const record = parseRequestLine('{"responseTime":10,"appMs":4,"req":{"method":"GET"},"route":"/x"}');
  assert.equal(record.appMs, undefined);
  assert.equal(record.upstreamMs, undefined);
  assert.equal(record.totalMs, 10);
});

test("blank lines are ignored, not counted as skipped", () => {
  const result = aggregate(["", "   ", '{"responseTime":3,"route":"/a","req":{"method":"GET"}}']);
  assert.equal(result.requests, 1);
  assert.equal(result.skipped, 0);
});

test("an empty log gives an empty, printable report", () => {
  const result = aggregate([]);
  assert.equal(result.requests, 0);
  assert.deepEqual(result.routes, []);
  assert.match(formatReport(result), /0 requests/);
});

test("selectLogFiles takes the daily files inside the window (UTC), in date order, and nothing else", () => {
  const names = [
    "backend-2026-09-20.log",
    "backend-2026-09-25.log",
    "backend-2026-09-26.log",
    "backend-2026-09-27.log", // tomorrow: not read
    "backend-2026-09-13.log",
    "backend-2026-09-12.log", // 15 days back with a 14-day window: out
    "backend-2026-09-26.log.gz",
    "backend-latest.log",
    "other-2026-09-26.log",
    "README.md",
  ];
  const now = Date.UTC(2026, 8, 26, 23, 59, 59);
  assert.deepEqual(selectLogFiles(names, 14, now), ["backend-2026-09-13.log", "backend-2026-09-20.log", "backend-2026-09-25.log", "backend-2026-09-26.log"]);
  assert.deepEqual(selectLogFiles(names, 2, now), ["backend-2026-09-25.log", "backend-2026-09-26.log"]);
  assert.deepEqual(selectLogFiles(names, 1, now), ["backend-2026-09-26.log"]);
  assert.equal(DEFAULT_DAYS, 14);
});

test("the report prints routes, counts and times, and never a URL", () => {
  const text = formatReport(aggregate(fixtureLines()));
  assert.match(text, /GET \/api\/servers\/:serverId\/factory/);
  assert.match(text, /Per game-server API/);
  assert.match(text, /^11 requests \(4 log lines skipped\)/);
  assert.equal(text.includes("bravo"), false);
  assert.equal(text.includes("alpha"), false);
});

// The CLI, as `npm run latency-report` runs it.
const script = path.join(here, "latency-report.mjs");
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });

test("CLI: --file prints the report and exits 0", () => {
  const result = run(["--file", FIXTURE]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Per route/);
  assert.match(result.stdout, /GET \/api\/servers\/:serverId\/status\s+5\s+0\s+60\s+100\s+100/);
});

test("CLI: --json prints the aggregate as JSON", () => {
  const result = run(["--file", FIXTURE, "--json"]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.requests, 11);
  assert.equal(parsed.upstreams[1].upstream, "frm");
});

test("CLI: --dir reads the daily files in the window (a copy of the fixture named for today)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "latency-"));
  try {
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(path.join(dir, `backend-${today}.log`), readFileSync(FIXTURE));
    writeFileSync(path.join(dir, "backend-2001-01-01.log"), '{"responseTime":99999,"route":"/old","req":{"method":"GET"}}\n');
    const result = run(["--dir", dir, "--days", "3"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^11 requests/);
    assert.equal(result.stdout.includes("/old"), false);
    // LOG_DIR is the default folder.
    assert.equal(run([], { LOG_DIR: dir }).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: no logs or bad options fail with a message and a non-zero exit", () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), "latency-empty-"));
  try {
    assert.equal(run(["--dir", empty]).status, 1);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  assert.equal(run([]).status, 2);
  assert.match(run([]).stderr, /LOG_DIR/);
  assert.equal(run(["--days", "0", "--dir", "x"]).status, 2);
  assert.equal(run(["--bogus"]).status, 2);
});
