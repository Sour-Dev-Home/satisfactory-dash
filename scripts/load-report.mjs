// ADR-0037 §3 (D4): turns one k6 load run into docs-vault/wiki/perf/<date>-<scenario>.md plus SVG charts beside it.
//
// What it reads:
//   --summary   k6's JSON output (`k6 run --out json=<file>`, one JSON object per line; `.gz` is read too). Only the
//               http_req_duration and http_req_failed points inside --since..--until count. Each request's `name` tag
//               is its route pattern (load/lib/plan.mjs), so routes, never URLs, are what the report shows.
//   the server  metrics.series_hourly rows (ADR-0037 §2) for the hours the window touches, from DATABASE_URL, which
//               must be a load database (LOAD_TEST=1, name ending in _load: load/lib/guards.mjs). `--rows <file>` reads
//               them from a JSON array instead (tests, or a copy taken earlier). The rows are hourly, so they include
//               anything else that ran in those hours on that database: use a fresh one per run (the runbook).
// Every number in the report and the charts comes from those two inputs; nothing is typed in by hand.
//
// Usage:
//   node scripts/load-report.mjs --summary <k6.json> --since <iso> --until <iso> --scenario <a|b|c>
//                                [--rows <rows.json>] [--out-dir <dir>] [--target <url>]
// Runbook: docs-vault/wiki/runbooks/load-testing.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { assertLoadDatabaseName, assertLoadDatabaseUrl, assertLocalTarget } from "../load/lib/guards.mjs";

const USAGE =
  "Usage: node scripts/load-report.mjs --summary <k6.json> --since <iso> --until <iso> --scenario <a|b|c> [--rows <rows.json>] [--out-dir <dir>] [--target <url>]";
const SCENARIO_NAMES = new Map([
  ["a", "a-baseline"],
  ["b", "b-target"],
  ["c", "c-knee"],
]);
const SCENARIO_TITLES = new Map([
  ["a", "(a) baseline: 1 agent and 3 users for 10 minutes"],
  ["b", "(b) target: 10 agents and 30 users for 30 minutes"],
  ["c", "(c) knee: agents added in steps until the snapshot p95 passes 1 s or errors pass 1%"],
]);
const SNAPSHOT_ROUTE = "POST /agent/v1/snapshots";
const KNEE_P95_MS = 1000;
const KNEE_ERROR_RATE = 0.01;
const WINDOW_MS = 60_000;
/** ADR-0037 §2: the 13 fixed bucket upper bounds (ms) of every stored histogram (platform/metrics/histogramBuckets.ts). */
const BUCKET_BOUNDS_MS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, Infinity];

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const FLAGS = new Map([
  ["--summary", "summary"],
  ["--since", "since"],
  ["--until", "until"],
  ["--scenario", "scenario"],
  ["--rows", "rows"],
  ["--out-dir", "outDir"],
  ["--target", "target"],
]);

export function parseReportArgs(argv) {
  const values = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = FLAGS.get(argv[i]);
    const value = argv[i + 1];
    if (key === undefined || values.has(key) || value === undefined || value === "") throw new Error(USAGE);
    values.set(key, value);
  }
  const since = values.get("since");
  const until = values.get("until");
  if (!values.has("summary") || !SCENARIO_NAMES.has(values.get("scenario")) || !ISO.test(since ?? "") || !ISO.test(until ?? "")) {
    throw new Error(USAGE);
  }
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);
  if (!(sinceMs < untilMs)) throw new Error(USAGE);
  return {
    summary: values.get("summary"),
    since: sinceMs,
    until: untilMs,
    scenario: values.get("scenario"),
    rows: values.get("rows"),
    outDir: values.get("outDir"),
    target: values.has("target") ? assertLocalTarget(values.get("target")) : undefined,
  };
}

/** `<UTC date of the run's start>-<scenario name>`, e.g. 2026-10-20-a-baseline. */
export function reportName(sinceMs, scenario) {
  return `${new Date(sinceMs).toISOString().slice(0, 10)}-${SCENARIO_NAMES.get(scenario)}`;
}

const KEPT_METRICS = new Set(["http_req_duration", "http_req_failed"]);

/** The request points inside the window: `{ t, metric, value, name, status, agent }`. Everything else is skipped. */
export function readK6Points(lines, sinceMs, untilMs) {
  const points = [];
  let skipped = 0;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const data = entry?.data;
    const t = Date.parse(data?.time);
    if (entry?.type !== "Point" || !KEPT_METRICS.has(entry.metric) || typeof data.value !== "number" || !(t >= sinceMs && t < untilMs)) {
      skipped++;
      continue;
    }
    const tags = data.tags ?? {};
    points.push({
      t,
      metric: entry.metric,
      value: data.value,
      name: typeof tags.name === "string" ? tags.name : "(unnamed)",
      status: typeof tags.status === "string" ? tags.status : "",
      agent: typeof tags.agent === "string" ? tags.agent : undefined,
    });
  }
  return { points, skipped };
}

/** Nearest rank of an ascending list; null for an empty one. */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

const round1 = (ms) => (ms === null ? null : Math.round(ms * 10) / 10);

/** Per route (the `name` tag): count, p50/p95/p99 (ms), errors and the status codes seen. Sorted by route. */
export function clientStats(points) {
  const routes = new Map();
  const routeOf = (name) => {
    if (!routes.has(name)) routes.set(name, { durations: [], errors: 0, statuses: {} });
    return routes.get(name);
  };
  for (const point of points) {
    const route = routeOf(point.name);
    if (point.metric === "http_req_duration") {
      route.durations.push(point.value);
      route.statuses[point.status] = (route.statuses[point.status] ?? 0) + 1;
    } else if (point.value > 0) {
      route.errors++;
    }
  }
  return [...routes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, route]) => {
      const sorted = route.durations.sort((a, b) => a - b);
      return {
        name,
        count: sorted.length,
        p50: round1(percentile(sorted, 0.5)),
        p95: round1(percentile(sorted, 0.95)),
        p99: round1(percentile(sorted, 0.99)),
        errors: route.errors,
        errorRate: sorted.length === 0 ? 0 : route.errors / sorted.length,
        statuses: route.statuses,
      };
    });
}

/** The upper bound (ms) of the bucket the p-th share of the counts falls in; Infinity past 5 s; null with no counts. */
export function bucketPercentile(counts, p) {
  if (!Array.isArray(counts) || counts.length !== BUCKET_BOUNDS_MS.length) {
    throw new Error(`A histogram row has ${BUCKET_BOUNDS_MS.length} buckets.`);
  }
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;
  const rank = Math.max(1, Math.ceil(p * total));
  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    seen += counts[i];
    if (seen >= rank) return BUCKET_BOUNDS_MS[i];
  }
  return Infinity;
}

function summarize(label, counts, count, extra = {}) {
  return { label, count, p50: bucketPercentile(counts, 0.5), p95: bucketPercentile(counts, 0.95), p99: bucketPercentile(counts, 0.99), ...extra };
}

/** Sums the histogram rows per route (all status classes), per query name, and for the ingest lag (all servers). */
export function serverStats(rows) {
  const groups = new Map();
  const add = (key, row) => {
    if (!groups.has(key)) groups.set(key, { counts: Array(BUCKET_BOUNDS_MS.length).fill(0), count: 0, errors5xx: 0 });
    const group = groups.get(key);
    row.bucket_counts.forEach((n, i) => (group.counts[i] += n));
    group.count += row.count;
    if (row.labels?.status_class === "5xx") group.errors5xx += row.count;
  };
  for (const row of rows) {
    if (!Array.isArray(row.bucket_counts) || row.count === 0) continue;
    if (row.metric === "http.server.request.duration" && typeof row.labels?.route === "string") add(`route\u0000${row.labels.route}`, row);
    else if (row.metric === "db.client.operation.duration" && typeof row.labels?.query === "string") add(`query\u0000${row.labels.query}`, row);
    else if (row.metric === "satis.agent.ingest.lag") add("lag\u0000", row);
  }
  const listOf = (kind, extra) =>
    [...groups.entries()]
      .filter(([key]) => key.startsWith(`${kind}\u0000`))
      .map(([key, group]) => summarize(key.slice(kind.length + 1), group.counts, group.count, extra(group)))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const lag = groups.get("lag\u0000");
  return {
    routes: listOf("route", (group) => ({ errors5xx: group.errors5xx })),
    queries: listOf("query", () => ({})),
    ingestLag: lag === undefined ? null : summarize("satis.agent.ingest.lag", lag.counts, lag.count),
  };
}

/** One window per minute from the start: all requests' percentiles, the error rate, the agents seen and the snapshot p95. */
export function timeline(points, sinceMs, untilMs) {
  const windows = [];
  for (let start = sinceMs, minute = 0; start < untilMs; start += WINDOW_MS, minute++) {
    windows.push({ minute, start, durations: [], snapshots: [], failed: 0, agents: new Set() });
  }
  for (const point of points) {
    const window = windows[Math.floor((point.t - sinceMs) / WINDOW_MS)];
    if (window === undefined) continue;
    if (point.metric === "http_req_duration") {
      window.durations.push(point.value);
      if (point.name === SNAPSHOT_ROUTE) {
        window.snapshots.push(point.value);
        if (point.agent !== undefined) window.agents.add(point.agent);
      }
    } else if (point.value > 0) {
      window.failed++;
    }
  }
  return windows.map(({ minute, start, durations, snapshots, failed, agents }) => {
    const all = durations.sort((a, b) => a - b);
    return {
      minute,
      start,
      count: all.length,
      p50: round1(percentile(all, 0.5)),
      p95: round1(percentile(all, 0.95)),
      p99: round1(percentile(all, 0.99)),
      errorRate: all.length === 0 ? 0 : failed / all.length,
      agents: agents.size,
      snapshotP95: round1(percentile(snapshots.sort((a, b) => a - b), 0.95)),
    };
  });
}

/** The first minute where the snapshot p95 passes 1 s or errors pass 1%, with the agents then and in the minute before. */
export function findKnee(windows) {
  let lastGood = null;
  for (const window of windows) {
    if (window.count === 0) continue;
    const slow = window.snapshotP95 !== null && window.snapshotP95 > KNEE_P95_MS;
    const failing = window.errorRate > KNEE_ERROR_RATE;
    if (slow || failing) {
      return {
        minute: window.minute,
        agents: window.agents,
        reason: slow ? "snapshot p95 above 1 s" : "errors above 1%",
        snapshotP95: window.snapshotP95,
        errorRate: window.errorRate,
        lastGoodAgents: lastGood?.agents ?? null,
      };
    }
    lastGood = window;
  }
  return null;
}

// ---- charts: plain SVG, every coordinate computed from the windows ----

const W = 720;
const H = 320;
const PAD = { left: 64, right: 16, top: 28, bottom: 44 };
const COLORS = { p50: "#2a9d8f", p95: "#e9a23b", p99: "#d1495b", limit: "#6c757d", axis: "#495057" };
const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => String(Math.round(n * 10) / 10);

/** A "nice" axis maximum: 1, 2 or 5 times a power of ten, at or above the value. */
function niceMax(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((m) => m * power).find((m) => m >= value);
}

function frame(title, desc, xLabel, yLabel, xMax, yMax, body) {
  const x = (v) => PAD.left + (v / xMax) * (W - PAD.left - PAD.right);
  const y = (v) => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const axis = [
    `<line x1="${PAD.left}" y1="${y(0)}" x2="${W - PAD.right}" y2="${y(0)}" stroke="${COLORS.axis}"/>`,
    `<line x1="${PAD.left}" y1="${y(0)}" x2="${PAD.left}" y2="${PAD.top}" stroke="${COLORS.axis}"/>`,
    ...ticks.map((f) => `<text x="${PAD.left - 6}" y="${y(f * yMax) + 4}" text-anchor="end">${fmt(f * yMax)}</text>`),
    ...ticks.map((f) => `<text x="${x(f * xMax)}" y="${H - PAD.bottom + 16}" text-anchor="middle">${fmt(f * xMax)}</text>`),
    `<text x="${(PAD.left + W - PAD.right) / 2}" y="${H - 6}" text-anchor="middle">${esc(xLabel)}</text>`,
    `<text x="14" y="${(PAD.top + H - PAD.bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(PAD.top + H - PAD.bottom) / 2})">${esc(yLabel)}</text>`,
    `<text x="${PAD.left}" y="18">${esc(title)}</text>`,
  ];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="sans-serif" font-size="12">`,
    `<title id="t">${esc(title)}</title>`,
    `<desc id="d">${esc(desc)}</desc>`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    ...axis,
    ...body(x, y),
    "</svg>",
    "",
  ].join("\n");
}

const polyline = (points, color, dash = "") =>
  points.length === 0 ? "" : `<polyline fill="none" stroke="${color}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ""} points="${points.map(([px, py]) => `${fmt(px)},${fmt(py)}`).join(" ")}"/>`;

/** All requests' p50/p95/p99 per minute of the run. */
export function latencySvg(windows) {
  const filled = windows.filter((w) => w.count > 0);
  const yMax = niceMax(Math.max(0, ...filled.map((w) => w.p99)));
  const xMax = Math.max(1, windows.length);
  const desc = filled.map((w) => `minute ${w.minute}: p50 ${w.p50} ms, p95 ${w.p95} ms, p99 ${w.p99} ms`).join("; ") || "no requests in the window";
  return frame("Latency percentiles per minute (all requests, client side)", desc, "minute of the run", "ms", xMax, yMax, (x, y) => {
    const series = ["p50", "p95", "p99"].map((key) => polyline(filled.map((w) => [x(w.minute + 0.5), y(w[key])]), COLORS[key]));
    const legend = ["p50", "p95", "p99"].map((key, i) => `<text x="${W - PAD.right - 150 + i * 50}" y="18" fill="${COLORS[key]}">${key}</text>`);
    return [...series, ...legend];
  });
}

/** The knee curve: snapshot p95 against the agents running, per minute, with the 1 s limit and the knee marked. */
export function kneeSvg(windows, knee) {
  const filled = windows.filter((w) => w.count > 0 && w.snapshotP95 !== null);
  const yMax = niceMax(Math.max(KNEE_P95_MS * 1.2, ...filled.map((w) => w.snapshotP95)));
  const xMax = niceMax(Math.max(1, ...filled.map((w) => w.agents)));
  const desc =
    (filled.map((w) => `${w.agents} agents: snapshot p95 ${w.snapshotP95} ms, errors ${fmt(w.errorRate * 100)}%`).join("; ") || "no snapshots in the window") +
    (knee ? `; knee at ${knee.agents} agents (${knee.reason})` : "; no knee reached");
  return frame("Knee curve: snapshot p95 by agents running", desc, "agents running", "snapshot p95 (ms)", xMax, yMax, (x, y) => [
    `<line x1="${PAD.left}" y1="${y(KNEE_P95_MS)}" x2="${W - PAD.right}" y2="${y(KNEE_P95_MS)}" stroke="${COLORS.limit}" stroke-dasharray="6 4"/>`,
    `<text x="${W - PAD.right}" y="${y(KNEE_P95_MS) - 6}" text-anchor="end" fill="${COLORS.limit}">1 s limit</text>`,
    polyline(filled.map((w) => [x(w.agents), y(w.snapshotP95)]), COLORS.p95),
    ...filled.map((w) => `<circle cx="${fmt(x(w.agents))}" cy="${fmt(y(w.snapshotP95))}" r="3" fill="${COLORS.p95}"/>`),
    ...(knee && knee.snapshotP95 !== null
      ? [
          `<circle cx="${fmt(x(knee.agents))}" cy="${fmt(y(Math.min(knee.snapshotP95, yMax)))}" r="7" fill="none" stroke="${COLORS.p99}" stroke-width="2"/>`,
          `<text x="${fmt(x(knee.agents))}" y="${fmt(y(Math.min(knee.snapshotP95, yMax)) - 12)}" text-anchor="middle" fill="${COLORS.p99}">knee: ${knee.agents} agents</text>`,
        ]
      : []),
  ]);
}

// ---- the markdown report ----

const ms = (value) => (value === null ? "–" : value === Infinity ? "> 5000" : fmt(value));
const pct = (rate) => `${fmt(rate * 100)}%`;

export function renderReport({ scenario, since, until, machine, target, client, server, windows, knee, charts }) {
  const lines = [
    `# Load report: scenario ${SCENARIO_TITLES.get(scenario).replace(/:.*$/, "")}`,
    "",
    `Generated by \`scripts/load-report.mjs\` from the k6 output and \`metrics.series_hourly\` (ADR-0037); no number here is typed in by hand.`,
    "",
    `- **Scenario:** ${SCENARIO_TITLES.get(scenario)}.`,
    `- **Window:** ${new Date(since).toISOString()} to ${new Date(until).toISOString()} (${fmt((until - since) / 60_000)} min).`,
    `- **Machine:** ${machine}.`,
    `- **Target:** ${target} (the local stack; ADR-0037 as amended: load runs never leave it).`,
    "",
    "## Client side (k6)",
    "",
    "Per route, in ms, nearest rank.",
    "",
    "| Route | Requests | p50 | p95 | p99 | Errors |",
    "|---|---|---|---|---|---|",
    ...client.map((r) => `| ${r.name} | ${r.count} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.p99)} | ${r.errors} (${pct(r.errorRate)}) |`),
    "",
    `![Latency percentiles per minute](./${charts.latency})`,
    "",
    "## Server side",
    "",
  ];
  const bucketTable = (heading, list, extraHeading, extra) => [
    `| ${heading} | Count | p50 | p95 | p99 |${extraHeading ? ` ${extraHeading} |` : ""}`,
    `|---|---|---|---|---|${extraHeading ? "---|" : ""}`,
    ...list.map((r) => `| ${r.label} | ${r.count} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.p99)} |${extraHeading ? ` ${extra(r)} |` : ""}`),
  ];
  if (server.routes.length === 0 && server.queries.length === 0 && server.ingestLag === null) {
    lines.push("No `metrics.series_hourly` rows for these hours: was the backend's 60 s flush given time to run after the load stopped?");
  } else {
    lines.push(
      "From the hourly histograms, so each value is the upper bound of its bucket (ms; 1, 2, 5, 10, 20, 50, 100, 200, 500, 1k, 2k, 5k)",
      "and the rows cover the whole hours the window touches.",
      "",
      "### Requests (`http.server.request.duration`)",
      "",
      ...bucketTable("Route", server.routes, "5xx", (r) => r.errors5xx),
      "",
      "### Queries (`db.client.operation.duration`)",
      "",
      ...(server.queries.length === 0 ? ["No query timing rows (the query timing of #447 was not present)."] : bucketTable("Query", server.queries)),
      "",
      "### Agent ingest lag (`satis.agent.ingest.lag`, apparent: includes clock skew)",
      "",
      ...(server.ingestLag === null ? ["No ingest-lag rows."] : bucketTable("Metric", [server.ingestLag])),
    );
  }
  const failing = client.filter((r) => r.errors > 0);
  lines.push(
    "",
    "## Errors",
    "",
    failing.length === 0
      ? "No failed requests."
      : failing.map((r) => `- ${r.name}: ${r.errors} of ${r.count} failed; statuses ${Object.entries(r.statuses).map(([s, n]) => `${s || "none"} ×${n}`).join(", ")} (0 = no response).`).join("\n"),
  );
  if (scenario === "c") {
    lines.push(
      "",
      "## Knee",
      "",
      knee === null
        ? `No knee: the snapshot p95 stayed at or under 1 s and errors at or under 1% up to ${Math.max(0, ...windows.map((w) => w.agents))} agents.`
        : `At minute ${knee.minute}, with ${knee.agents} agents running: ${knee.reason} (snapshot p95 ${ms(knee.snapshotP95)} ms, errors ${pct(knee.errorRate)}).` +
            (knee.lastGoodAgents === null ? "" : ` The minute before, ${knee.lastGoodAgents} agents were within both limits.`),
      "",
      `![Knee curve](./${charts.knee})`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function machineSummary() {
  const cpus = os.cpus();
  return `${cpus[0]?.model?.trim() || "unknown CPU"} × ${cpus.length}, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM, ${os.type()} ${os.release()}, Node ${process.version}`;
}

const SERIES_QUERY = `
  SELECT metric, labels, count, sum, bucket_counts
  FROM metrics.series_hourly
  WHERE hour >= date_trunc('hour', $1::timestamptz) AND hour < $2::timestamptz`;

async function readServerRows(args) {
  if (args.rows !== undefined) return JSON.parse(readFileSync(args.rows, "utf8"));
  const databaseUrl = process.env.DATABASE_URL ?? "";
  assertLoadDatabaseUrl(databaseUrl, process.env);
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    assertLoadDatabaseName((await client.query("SELECT current_database() AS name")).rows[0]?.name);
    return (await client.query(SERIES_QUERY, [new Date(args.since).toISOString(), new Date(args.until).toISOString()])).rows;
  } finally {
    await client.end();
  }
}

function seededTarget() {
  const file = fileURLToPath(new URL("../load/.data/seed.json", import.meta.url));
  try {
    return existsSync(file) ? assertLocalTarget(JSON.parse(readFileSync(file, "utf8")).target) : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  let args;
  let rows;
  try {
    args = parseReportArgs(process.argv.slice(2));
    rows = await readServerRows(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : USAGE;
    // Only a usage or guard error is exit 2; a missing or malformed rows file or a failed connection is exit 1.
    if (message !== USAGE && !message.startsWith("Refused")) throw err;
    console.error(message);
    process.exit(2);
  }
  const raw = readFileSync(args.summary);
  const text = args.summary.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  const { points, skipped } = readK6Points(text.split("\n"), args.since, args.until);
  const windows = timeline(points, args.since, args.until);
  const knee = args.scenario === "c" ? findKnee(windows) : null;
  const name = reportName(args.since, args.scenario);
  const charts = { latency: `${name}-latency.svg`, knee: `${name}-knee.svg` };
  const outDir = args.outDir ?? fileURLToPath(new URL("../docs-vault/wiki/perf/", import.meta.url));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, charts.latency), latencySvg(windows));
  if (args.scenario === "c") writeFileSync(path.join(outDir, charts.knee), kneeSvg(windows, knee));
  const report = renderReport({
    scenario: args.scenario,
    since: args.since,
    until: args.until,
    machine: machineSummary(),
    target: args.target ?? seededTarget() ?? "unknown (pass --target)",
    client: clientStats(points),
    server: serverStats(rows),
    windows,
    knee,
    charts,
  });
  writeFileSync(path.join(outDir, `${name}.md`), report);
  console.log(`Wrote ${name}.md (${points.length} request points in the window, ${skipped} other lines skipped, ${rows.length} server rows).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    // A missing or malformed input: one line, no stack.
    console.error(`load-report: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
