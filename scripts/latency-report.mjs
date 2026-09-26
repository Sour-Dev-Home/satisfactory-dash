// `npm run latency-report` (ADR-0032 step 1): p50, p95 and p99 per route and per game-server API, from the backend's
// daily log files (`backend-YYYY-MM-DD.log`, one JSON object per line, kept 14 days).
//
// What it reads: the request lines pino-http writes ("request completed" / "request errored"), which carry
//   responseTime (ms, the whole request), route (the pattern it matched, never the URL),
//   appMs / upstreamMs / vanillaMs / frmMs (how the request's time split, ADR-0032) and upstreamCalls.
// Lines from before the split have no appMs and count only in the total. Lines that are not JSON, and JSON lines that
// are not request lines, are skipped (and counted). It never prints a URL, a user or an address: routes, counts and times.
//
// Usage:
//   npm run latency-report                              the logs in $LOG_DIR of the last 14 days
//   npm run latency-report -- --dir <folder> --days 3   another folder, fewer days
//   npm run latency-report -- --file a.log --file b.log specific files (no date filter)
//   npm run latency-report -- --json                    the aggregate as JSON
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DAYS = 14;
const LOG_FILE = /^backend-(\d{4})-(\d{2})-(\d{2})\.log$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const isNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * The log files inside the window: today and the `days - 1` days before it (UTC, like the files' own names). Files that
 * do not match the daily name are ignored. Returns the names in date order.
 */
export function selectLogFiles(names, days, now) {
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  return names
    .map((name) => ({ name, match: LOG_FILE.exec(name) }))
    .filter(({ match }) => match !== null)
    .map(({ name, match }) => ({ name, day: Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) }))
    .filter(({ day }) => day <= today && day > today - days * DAY_MS)
    .sort((a, b) => a.day - b.day)
    .map(({ name }) => name);
}

/**
 * One request line, or undefined for anything else. The route is the matched pattern, "(unmatched)" for a request no
 * route handled (a 404, a rejected body). The split fields are present only on lines written after ADR-0032.
 */
export function parseRequestLine(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof entry !== "object" || entry === null || !isNumber(entry.responseTime)) return undefined;
  const method = typeof entry.req?.method === "string" ? entry.req.method : "?";
  const route = typeof entry.route === "string" ? entry.route : "(unmatched)";
  const split = isNumber(entry.appMs) && isNumber(entry.upstreamMs);
  return {
    key: `${method} ${route}`,
    totalMs: entry.responseTime,
    failed: typeof entry.res?.statusCode === "number" && entry.res.statusCode >= 500,
    appMs: split ? entry.appMs : undefined,
    upstreamMs: split ? entry.upstreamMs : undefined,
    vanillaMs: split && isNumber(entry.vanillaMs) ? entry.vanillaMs : undefined,
    frmMs: split && isNumber(entry.frmMs) ? entry.frmMs : undefined,
  };
}

/** Nearest-rank percentile of an ascending list (p in 0..100), or undefined for an empty list. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return undefined;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

const ascending = (values) => [...values].sort((a, b) => a - b);
const stats = (values) => {
  const sorted = ascending(values);
  return { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99) };
};

/**
 * @param {string[]} lines every line of every log file
 * @returns {{ requests: number; skipped: number; routes: object[]; upstreams: object[] }}
 *   routes: per "METHOD route", sorted by p95 total time (slowest first)
 *   upstreams: vanilla and frm, over the requests that waited on that API at all
 */
export function aggregate(lines) {
  const byRoute = new Map();
  const vanilla = [];
  const frm = [];
  let requests = 0;
  let skipped = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const record = parseRequestLine(line);
    if (record === undefined) {
      skipped++;
      continue;
    }
    requests++;
    const route = byRoute.get(record.key) ?? { key: record.key, total: [], app: [], upstream: [], failed: 0 };
    route.total.push(record.totalMs);
    if (record.appMs !== undefined) {
      route.app.push(record.appMs);
      route.upstream.push(record.upstreamMs);
    }
    if (record.failed) route.failed++;
    byRoute.set(record.key, route);
    if (record.vanillaMs > 0) vanilla.push(record.vanillaMs);
    if (record.frmMs > 0) frm.push(record.frmMs);
  }
  const routes = [...byRoute.values()]
    .map((route) => ({ route: route.key, failed: route.failed, total: stats(route.total), app: stats(route.app), upstream: stats(route.upstream) }))
    .sort((a, b) => b.total.p95 - a.total.p95 || a.route.localeCompare(b.route));
  return {
    requests,
    skipped,
    routes,
    upstreams: [{ upstream: "vanilla", ...stats(vanilla) }, { upstream: "frm", ...stats(frm) }],
  };
}

const cell = (value) => (value === undefined ? "-" : String(Math.round(value * 10) / 10));

/** The aggregate as plain-text tables. Times are milliseconds. */
export function formatReport(result) {
  const rows = [
    ["route", "n", "failed", "total p50", "p95", "p99", "app p50", "p95", "p99", "upstream p50", "p95", "p99"],
    ...result.routes.map((r) => [
      r.route,
      r.total.n,
      r.failed,
      cell(r.total.p50),
      cell(r.total.p95),
      cell(r.total.p99),
      cell(r.app.p50),
      cell(r.app.p95),
      cell(r.app.p99),
      cell(r.upstream.p50),
      cell(r.upstream.p95),
      cell(r.upstream.p99),
    ]),
  ];
  const upstreamRows = [
    ["game server API", "requests that used it", "p50", "p95", "p99"],
    ...result.upstreams.map((u) => [u.upstream, u.n, cell(u.p50), cell(u.p95), cell(u.p99)]),
  ];
  const table = (matrix) => {
    const widths = matrix[0].map((_, column) => Math.max(...matrix.map((row) => String(row[column]).length)));
    return matrix.map((row) => row.map((value, column) => (column === 0 ? String(value).padEnd(widths[column]) : String(value).padStart(widths[column]))).join("  ")).join("\n");
  };
  return [
    `${result.requests} requests (${result.skipped} log lines skipped). Times in ms; app + upstream = total.`,
    "",
    "Per route (slowest p95 first)",
    table(rows),
    "",
    "Per game-server API (time the request waited on it; parallel calls overlap)",
    table(upstreamRows),
    "",
  ].join("\n");
}

function parseArgs(argv, env) {
  const options = { dir: env.LOG_DIR?.trim() || undefined, days: DEFAULT_DAYS, files: [], json: false };
  const valueOf = (name, index) => {
    const value = argv[index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--dir") options.dir = valueOf(arg, ++i);
    else if (arg === "--file") options.files.push(valueOf(arg, ++i));
    else if (arg === "--days") options.days = Number(valueOf(arg, ++i));
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 366) throw new Error("--days must be a whole number from 1 to 366");
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(`${err.message}\nUsage: npm run latency-report -- [--dir <folder>] [--days N] [--file <log>]... [--json]`);
    process.exit(2);
  }
  let files = options.files;
  let lines;
  try {
    if (files.length === 0) {
      if (!options.dir) {
        console.error("No logs to read: set LOG_DIR, or pass --dir <folder> or --file <log>.");
        process.exit(2);
      }
      files = selectLogFiles(readdirSync(options.dir), options.days, Date.now()).map((name) => path.join(options.dir, name));
      if (files.length === 0) {
        console.error(`No backend-YYYY-MM-DD.log files in the last ${options.days} days in that folder.`);
        process.exit(1);
      }
    }
    lines = files.flatMap((file) => readFileSync(file, "utf8").split("\n"));
  } catch (err) {
    // A folder or file that cannot be read: one line, no stack trace.
    console.error(`Cannot read the logs (${err.code ?? "error"}).`);
    process.exit(1);
  }
  const result = aggregate(lines);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatReport(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
