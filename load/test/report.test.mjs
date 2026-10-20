import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  bucketPercentile,
  clientStats,
  findKnee,
  kneeSvg,
  latencySvg,
  parseReportArgs,
  readK6Points,
  renderReport,
  reportName,
  serverStats,
  timeline,
} from "../../scripts/load-report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "..", "..", "scripts", "load-report.mjs");
const SINCE = "2026-10-20T10:00:00.000Z";
const UNTIL = "2026-10-20T10:03:00.000Z";
const at = (seconds) => new Date(Date.parse(SINCE) + seconds * 1000).toISOString();

/** k6 `--out json` lines: a duration point and a failed point per request, plus noise k6 also writes. */
function k6Lines(requests) {
  const lines = ['{"type":"Metric","data":{"name":"http_req_duration","type":"trend"},"metric":"http_req_duration"}'];
  for (const r of requests) {
    const tags = { name: r.name, status: String(r.status ?? 200), ...(r.agent === undefined ? {} : { agent: String(r.agent) }) };
    lines.push(JSON.stringify({ type: "Point", metric: "http_req_duration", data: { time: at(r.t), value: r.ms, tags } }));
    lines.push(JSON.stringify({ type: "Point", metric: "http_req_failed", data: { time: at(r.t), value: r.failed ? 1 : 0, tags } }));
    lines.push(JSON.stringify({ type: "Point", metric: "http_reqs", data: { time: at(r.t), value: 1, tags } }));
  }
  lines.push("not json", "");
  return lines;
}

const SNAP = "POST /agent/v1/snapshots";
const STATUS = "GET /api/servers/:serverId/status";

test("the CLI takes --summary, --since, --until and --scenario, and checks them", () => {
  const args = parseReportArgs(["--summary", "a.json", "--since", SINCE, "--until", UNTIL, "--scenario", "a"]);
  assert.equal(args.summary, "a.json");
  assert.equal(args.scenario, "a");
  assert.equal(args.since, Date.parse(SINCE));
  assert.equal(args.until, Date.parse(UNTIL));
  for (const argv of [
    [],
    ["--summary", "a.json", "--since", SINCE, "--until", UNTIL],
    ["--summary", "a.json", "--since", SINCE, "--until", UNTIL, "--scenario", "d"],
    ["--summary", "a.json", "--since", "yesterday", "--until", UNTIL, "--scenario", "a"],
    ["--summary", "a.json", "--since", UNTIL, "--until", SINCE, "--scenario", "a"],
    ["--summary", "a.json", "--since", SINCE, "--until", UNTIL, "--scenario", "a", "--bogus", "x"],
  ]) {
    assert.throws(() => parseReportArgs(argv), /Usage/, argv.join(" "));
  }
});

test("the report is named <date>-<scenario>.md after the run's start date", () => {
  assert.equal(reportName(Date.parse(SINCE), "a"), "2026-10-20-a-baseline");
  assert.equal(reportName(Date.parse(SINCE), "c"), "2026-10-20-c-knee");
});

test("k6 points are read inside the run window only; other lines are counted and skipped", () => {
  const lines = k6Lines([
    { t: 1, name: STATUS, ms: 10 },
    { t: 200, name: STATUS, ms: 99 },
  ]);
  const { points, skipped } = readK6Points(lines, Date.parse(SINCE), Date.parse(UNTIL));
  assert.equal(points.length, 2); // one duration and one failed point inside the window
  assert.deepEqual(points.map((p) => p.metric).sort(), ["http_req_duration", "http_req_failed"]);
  assert.ok(skipped >= 2);
});

test("client-side p50/p95/p99 and errors are per route", () => {
  const requests = [];
  for (let i = 1; i <= 100; i++) requests.push({ t: i, name: STATUS, ms: i });
  requests.push({ t: 5, name: SNAP, ms: 40, agent: 0 }, { t: 10, name: SNAP, ms: 60, agent: 0, failed: true, status: 429 });
  const stats = clientStats(readK6Points(k6Lines(requests), Date.parse(SINCE), Date.parse(UNTIL)).points);
  const status = stats.find((s) => s.name === STATUS);
  assert.deepEqual([status.count, status.p50, status.p95, status.p99, status.errors], [100, 50, 95, 99, 0]);
  const snap = stats.find((s) => s.name === SNAP);
  assert.equal(snap.errors, 1);
  assert.equal(snap.errorRate, 0.5);
  assert.deepEqual(snap.statuses, { 200: 1, 429: 1 });
});

test("a bucket percentile is the upper bound of the bucket it falls in", () => {
  // 13 buckets: 1,2,5,10,20,50,100,200,500,1k,2k,5k,+inf
  const counts = [0, 0, 0, 50, 40, 9, 1, 0, 0, 0, 0, 0, 0];
  assert.equal(bucketPercentile(counts, 0.5), 10);
  assert.equal(bucketPercentile(counts, 0.95), 50);
  assert.equal(bucketPercentile(counts, 0.99), 50);
  assert.equal(bucketPercentile(counts, 1), 100);
  assert.equal(bucketPercentile([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3], 0.5), Infinity);
  assert.equal(bucketPercentile(Array(13).fill(0), 0.5), null);
  assert.throws(() => bucketPercentile([1, 2], 0.5), /13/);
});

test("server-side rows are summed per route, per query name and for the ingest lag", () => {
  const b = (i, n) => Object.assign(Array(13).fill(0), { [i]: n });
  const rows = [
    { metric: "http.server.request.duration", labels: { route: "/api/servers/:serverId/status", status_class: "2xx" }, count: 90, sum: 900, bucket_counts: b(3, 90) },
    { metric: "http.server.request.duration", labels: { route: "/api/servers/:serverId/status", status_class: "5xx" }, count: 10, sum: 5000, bucket_counts: b(8, 10) },
    { metric: "http.server.request.duration", labels: { route: "/api/servers/:serverId/status", status_class: "2xx" }, count: 0, sum: 0, bucket_counts: b(3, 0) },
    { metric: "db.client.operation.duration", labels: { query: "servers.findServerByPublicId" }, count: 4, sum: 8, bucket_counts: b(1, 4) },
    { metric: "satis.agent.ingest.lag", labels: { server: "load-001" }, count: 5, sum: 50, bucket_counts: b(3, 5) },
    { metric: "satis.agent.ingest.lag", labels: { server: "load-002" }, count: 5, sum: 500, bucket_counts: b(6, 5) },
    { metric: "satis.history.rows_written", labels: { table: "power" }, count: 3, sum: 3, bucket_counts: null },
  ];
  const stats = serverStats(rows);
  const route = stats.routes.find((r) => r.label === "/api/servers/:serverId/status");
  assert.deepEqual([route.count, route.p50, route.p95, route.p99, route.errors5xx], [100, 10, 500, 500, 10]);
  assert.deepEqual(stats.queries.map((q) => [q.label, q.count, q.p95]), [["servers.findServerByPublicId", 4, 2]]);
  assert.deepEqual([stats.ingestLag.count, stats.ingestLag.p50, stats.ingestLag.p99], [10, 10, 100]);
});

test("the timeline has one window per minute with the active agents and the snapshot p95", () => {
  const requests = [];
  for (let s = 0; s < 180; s += 5) {
    const agents = s < 60 ? 1 : s < 120 ? 2 : 3;
    for (let a = 0; a < agents; a++) requests.push({ t: s, name: SNAP, ms: s < 120 ? 50 : 1500, agent: a });
  }
  const windows = timeline(readK6Points(k6Lines(requests), Date.parse(SINCE), Date.parse(UNTIL)).points, Date.parse(SINCE), Date.parse(UNTIL));
  assert.equal(windows.length, 3);
  assert.deepEqual(windows.map((w) => w.agents), [1, 2, 3]);
  assert.deepEqual(windows.map((w) => w.snapshotP95), [50, 50, 1500]);
  const knee = findKnee(windows);
  assert.deepEqual([knee.minute, knee.agents, knee.reason, knee.lastGoodAgents], [2, 3, "snapshot p95 above 1 s", 2]);
});

test("the knee is also where errors pass 1%, and absent when neither limit is passed", () => {
  const base = { start: 0, count: 100, p50: 1, p95: 1, p99: 1, snapshotP95: 10 };
  assert.equal(findKnee([{ ...base, minute: 0, agents: 5, errorRate: 0 }]), null);
  const knee = findKnee([
    { ...base, minute: 0, agents: 5, errorRate: 0.01 },
    { ...base, minute: 1, agents: 10, errorRate: 0.02 },
  ]);
  assert.deepEqual([knee.minute, knee.agents, knee.reason, knee.lastGoodAgents], [1, 10, "errors above 1%", 5]);
  assert.equal(findKnee([{ ...base, minute: 0, agents: 0, count: 0, errorRate: 0, snapshotP95: null }]), null);
});

test("the charts are SVG drawn from the data, with a text alternative", () => {
  const windows = [
    { minute: 0, start: 0, count: 10, p50: 10, p95: 20, p99: 30, errorRate: 0, agents: 5, snapshotP95: 20 },
    { minute: 1, start: 60_000, count: 10, p50: 15, p95: 1500, p99: 2000, errorRate: 0.05, agents: 10, snapshotP95: 1500 },
  ];
  const latency = latencySvg(windows);
  assert.match(latency, /^<svg [^>]*role="img"/);
  assert.match(latency, /<title[ >]/);
  assert.match(latency, /<desc[^>]*>minute 0: p50 10 ms/);
  assert.match(latency, /p95/);
  assert.match(latency, /2000/); // the axis reaches the largest value
  const knee = kneeSvg(windows, findKnee(windows));
  assert.match(knee, /1 s limit/);
  assert.match(knee, /knee: 10 agents/);
  assert.doesNotMatch(latency + knee, /NaN|undefined/);
  assert.doesNotMatch(latencySvg([]), /NaN|undefined/);
});

test("the report has the machine, target, scenario, both sides' percentiles, errors and, for (c), the knee", () => {
  const requests = [
    { t: 1, name: STATUS, ms: 12 },
    { t: 2, name: SNAP, ms: 30, agent: 0 },
    { t: 3, name: SNAP, ms: 1, agent: 0, failed: true, status: 0 },
  ];
  const points = readK6Points(k6Lines(requests), Date.parse(SINCE), Date.parse(UNTIL)).points;
  const windows = timeline(points, Date.parse(SINCE), Date.parse(UNTIL));
  const md = renderReport({
    scenario: "c",
    since: Date.parse(SINCE),
    until: Date.parse(UNTIL),
    machine: "Test CPU × 8, 16 GB RAM, Linux 6.1, Node v22.0.0",
    target: "http://127.0.0.1:3001",
    client: clientStats(points),
    server: serverStats([]),
    windows,
    knee: findKnee(windows),
    charts: { latency: "2026-10-20-c-knee-latency.svg", knee: "2026-10-20-c-knee-knee.svg" },
  });
  assert.match(md, /^# Load report: scenario \(c\) knee/m);
  assert.match(md, /Test CPU × 8/);
  assert.match(md, /http:\/\/127\.0\.0\.1:3001/);
  assert.match(md, /\| GET \/api\/servers\/:serverId\/status \| 1 \| 12 \| 12 \| 12 \|/);
  assert.match(md, /## Server side/);
  assert.match(md, /No `metrics.series_hourly` rows/);
  assert.match(md, /## Errors/);
  assert.match(md, /## Knee/);
  assert.match(md, /!\[[^\]]+\]\(\.\/2026-10-20-c-knee-latency\.svg\)/);
  assert.doesNotMatch(md, /NaN|undefined/);
});

test("end to end: a gzip k6 output and a rows file become a report and its charts", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "load-report-"));
  try {
    const summary = path.join(dir, "a.json.gz");
    writeFileSync(summary, gzipSync(k6Lines([{ t: 1, name: STATUS, ms: 12 }, { t: 2, name: SNAP, ms: 30, agent: 0 }]).join("\n")));
    const rows = path.join(dir, "rows.json");
    writeFileSync(rows, JSON.stringify([{ metric: "http.server.request.duration", labels: { route: "/api/servers/:serverId/status", status_class: "2xx" }, count: 1, sum: 3, bucket_counts: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }]));
    const out = path.join(dir, "perf");
    const run = spawnSync(process.execPath, [SCRIPT, "--summary", summary, "--since", SINCE, "--until", UNTIL, "--scenario", "a", "--rows", rows, "--out-dir", out], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(readdirSync(out).sort(), ["2026-10-20-a-baseline-latency.svg", "2026-10-20-a-baseline.md"]);
    const md = readFileSync(path.join(out, "2026-10-20-a-baseline.md"), "utf8");
    assert.match(md, /\| \/api\/servers\/:serverId\/status \| 1 \| 5 \| 5 \| 5 \|/);
    assert.doesNotMatch(md, /## Knee/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without --rows the report reads the database only through the load guard", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "load-report-"));
  try {
    const summary = path.join(dir, "a.json");
    writeFileSync(summary, k6Lines([{ t: 1, name: STATUS, ms: 12 }]).join("\n"));
    const run = spawnSync(process.execPath, [SCRIPT, "--summary", summary, "--since", SINCE, "--until", UNTIL, "--scenario", "a", "--out-dir", dir], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "postgres://u:p@127.0.0.1/satis", LOAD_TEST: "1" },
    });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /_load/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
