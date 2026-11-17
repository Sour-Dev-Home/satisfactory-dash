// CI's dependency audit (the `security` job). It fails on any high or critical advisory, like
// `npm audit --audit-level=high`, except advisories listed in `.github/audit-exceptions.json`. Each row names the GHSA
// id, the packages it may come from, why, the day it was granted and the day it expires, at most MAX_EXCEPTION_DAYS
// after `granted`. An expired exception fails again, so nothing is waived for good; renewing one means a new `granted`
// date in the diff. A listed advisory reported for a package the row doesn't name still fails. Every waiver is a
// `::warning::` annotation on the run, so it can't go unseen.
//
//   node scripts/audit-gate.mjs            runs `npm audit --json` and checks it
//   node scripts/audit-gate.mjs <file>     checks a saved `npm audit --json` output instead
//
// Fails closed: output that isn't the audit JSON this script understands fails the job.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const EXCEPTIONS_FILE = ".github/audit-exceptions.json";
export const MAX_EXCEPTION_DAYS = 90;
const BLOCKING = new Set(["high", "critical"]);
const SEVERITIES = new Set(["info", "low", "moderate", "high", "critical"]);
const PACKAGE_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
const GHSA = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// The advisories behind `npm audit --json` (v2 report): only the `via` entries that are objects are advisories; string
// entries just say "through that package", which has its own entry. Returns one row per advisory id.
export function advisoriesFrom(report) {
  if (report === null || typeof report !== "object" || report.auditReportVersion !== 2) {
    throw new Error("not an npm audit v2 JSON report");
  }
  if (report.error) throw new Error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  const vulnerabilities = report.vulnerabilities;
  if (vulnerabilities === null || typeof vulnerabilities !== "object") throw new Error("the report has no vulnerabilities object");
  const byId = new Map();
  for (const entry of Object.values(vulnerabilities)) {
    if (!Array.isArray(entry?.via)) throw new Error("a vulnerability entry has no via list");
    for (const via of entry.via) {
      if (typeof via === "string") continue;
      const id = typeof via?.url === "string" ? via.url.split("/").pop() : "";
      if (!GHSA.test(id) || typeof via.severity !== "string") throw new Error(`an advisory without a GHSA url or severity: ${JSON.stringify(via)}`);
      // An unknown severity could be a blocking one under a new name: fail rather than skip it.
      if (!SEVERITIES.has(via.severity)) throw new Error(`advisory ${id} has an unknown severity ${JSON.stringify(via.severity)}`);
      const row = byId.get(id) ?? { id, severity: via.severity, title: String(via.title ?? ""), packages: new Set() };
      row.packages.add(String(via.name ?? ""));
      byId.set(id, row);
    }
  }
  return [...byId.values()];
}

// Validates the exceptions file. Every row needs a GHSA id, the package names it covers, a reason, and `granted` and
// `expires` dates (YYYY-MM-DD): granted no later than today, expires no more than MAX_EXCEPTION_DAYS after granted.
// Returns a Map of id to row, or throws naming the bad row.
export function parseExceptions(rows, today) {
  if (!Array.isArray(rows)) throw new Error(`${EXCEPTIONS_FILE} must be a JSON array`);
  const byId = new Map();
  for (const row of rows) {
    const label = JSON.stringify(row);
    if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error(`exception ${label} is not an object`);
    const keys = Object.keys(row).sort().join(",");
    if (keys !== "expires,granted,id,packages,reason") {
      throw new Error(`exception ${label} must have exactly id, packages, reason, granted and expires`);
    }
    if (typeof row.id !== "string" || !GHSA.test(row.id)) throw new Error(`exception ${label}: id is not a GHSA id`);
    if (!Array.isArray(row.packages) || row.packages.length === 0 || !row.packages.every((p) => typeof p === "string" && PACKAGE_NAME.test(p))) {
      throw new Error(`exception ${label}: packages must be a non-empty list of package names`);
    }
    if (typeof row.reason !== "string" || row.reason.trim().length < 20) throw new Error(`exception ${label}: reason must say why (20+ characters)`);
    const granted = parseDay(row.granted);
    const expires = parseDay(row.expires);
    if (granted === null || expires === null) throw new Error(`exception ${label}: granted and expires must be real dates, YYYY-MM-DD`);
    if (granted > today) throw new Error(`exception ${row.id} is granted in the future`);
    if (expires < granted) throw new Error(`exception ${row.id} expires before it is granted`);
    if (expires - granted > MAX_EXCEPTION_DAYS * DAY_MS) throw new Error(`exception ${row.id} runs more than ${MAX_EXCEPTION_DAYS} days after it was granted`);
    if (byId.has(row.id)) throw new Error(`exception ${row.id} is listed twice`);
    byId.set(row.id, { ...row, packages: new Set(row.packages), expiresAt: expires });
  }
  return byId;
}

function parseDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : ms;
}

// The verdict. `today` is midnight UTC of the current day; an exception holds through its expiry day.
export function verdict(advisories, exceptions, today) {
  const failures = [];
  const waived = [];
  for (const a of advisories) {
    if (!BLOCKING.has(a.severity)) continue;
    const exception = exceptions.get(a.id);
    const where = `${a.id} (${a.severity}, ${[...a.packages].sort().join(", ")}): ${a.title}`;
    const uncovered = [...a.packages].filter((p) => !exception?.packages.has(p)).sort();
    if (!exception) failures.push(`${where}. Not in ${EXCEPTIONS_FILE}.`);
    else if (uncovered.length > 0) failures.push(`${where}. Its exception doesn't cover ${uncovered.join(", ")}.`);
    else if (exception.expiresAt < today) failures.push(`${where}. Its exception expired on ${exception.expires}.`);
    else waived.push(`${where}. Excepted until ${exception.expires}: ${exception.reason}`);
  }
  const present = new Set(advisories.map((a) => a.id));
  const unused = [...exceptions.keys()].filter((id) => !present.has(id));
  return { ok: failures.length === 0, failures, waived, unused };
}

function todayUtc(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function readReport(path) {
  if (path) return readFileSync(path, "utf8");
  // npm audit exits 1 whenever it finds anything, so the exit code says nothing here; the JSON decides.
  // Windows can only start npm (npm.cmd) through a shell; the command is a fixed string, no input reaches it.
  const options = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
  const run =
    process.platform === "win32"
      ? spawnSync("npm audit --json", { ...options, shell: true })
      : spawnSync("npm", ["audit", "--json"], options);
  if (run.error) throw run.error;
  if (run.stderr) process.stderr.write(run.stderr);
  return run.stdout;
}

function main() {
  const today = todayUtc();
  const exceptions = parseExceptions(JSON.parse(readFileSync(EXCEPTIONS_FILE, "utf8")), today);
  const result = verdict(advisoriesFrom(JSON.parse(readReport(process.argv[2]))), exceptions, today);
  for (const line of result.waived) console.log(`::warning::excepted: ${line}`);
  for (const id of result.unused) console.log(`::warning::${id} is in ${EXCEPTIONS_FILE} but no longer reported; remove it.`);
  for (const line of result.failures) console.log(`::error::${line}`);
  console.log(result.ok ? "audit gate: no high or critical advisory without a current exception" : "audit gate: failed");
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.log(`::error::audit gate: ${error.message}`);
    process.exitCode = 1;
  }
}
