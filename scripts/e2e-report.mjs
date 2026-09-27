#!/usr/bin/env node
// A UI PR's CI in one command (#286): given a PR number, branch or SHA, wait for that head's runs,
// then print pass/fail, the failing e2e tests and snapshots, and the tab-switch CLS report. With
// --baselines, fetch the regenerated screenshots of a `update_snapshots` run on that head and sort
// them with Playwright's own comparator: real changes (and new states) versus drift within the
// threshold, which is left alone. --apply copies only the real changes into the tree.
//
//   npm run e2e:report -- 260
//   npm run e2e:report -- feat/my-branch --baselines            # list what would change
//   npm run e2e:report -- feat/my-branch --baselines --dispatch # start the regeneration first
//   npm run e2e:report -- feat/my-branch --baselines --apply    # copy the real changes
//
// The parsers and the classifier are pure and tested (e2e-report.test.mjs); the rest drives `gh`.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCREENSHOTS = join(ROOT, "frontend", "e2e", "__screenshots__");
const POLL_MS = 30_000;

/** A `gh run view --log` line is "job<TAB>step<TAB>timestamp text"; keep the text. */
export function stripLogPrefix(line) {
  return line.replace(/^[^\t]*\t[^\t]*\t\S+Z ?/, "");
}

/**
 * Playwright's list-reporter summary: "  2 failed" / "  1 flaky", each followed by its tests
 * ("    [desktop] › e2e/x.spec.ts:10:3 › title ───"). Returns the unique titles per kind.
 */
export function parseSummary(text) {
  const out = { failed: [], flaky: [] };
  let kind;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripLogPrefix(raw);
    const head = line.match(/^\s+\d+ (failed|flaky)\s*$/);
    if (head) {
      kind = head[1];
      continue;
    }
    // A different summary count line ("N passed" / "N skipped" / "N did not run" / "N interrupted")
    // ends the current section. Anything else is unrelated output (e.g. another step's log
    // interleaved by timestamp) and is skipped without abandoning the section: a single stray
    // line must not cause every test listed after it to be dropped.
    if (/^\s+\d+ (passed|skipped|did not run|interrupted)\b/.test(line)) {
      kind = undefined;
      continue;
    }
    const test = kind && line.match(/^\s+(\[[^\]]+\] › .+?)\s*[─-]*\s*$/);
    if (test && !out[kind].includes(test[1])) out[kind].push(test[1]);
  }
  return out;
}

/** The snapshot files named in failure details ("Snapshot: default-factory.png"). */
export function parseSnapshots(text) {
  return [...new Set([...text.matchAll(/Snapshot: (\S+\.png)/g)].map((m) => m[1]))];
}

/**
 * The tab-switch spec's `tab-switch CLS {...}` reports: one JSON object per test, printed across
 * several lines and closed by a "}" at the start of a line.
 */
export function parseClsReports(text) {
  const reports = [];
  let buf;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripLogPrefix(raw);
    if (buf === undefined) {
      const start = line.indexOf("tab-switch CLS {");
      if (start >= 0) buf = [line.slice(start + "tab-switch CLS ".length)];
      continue;
    }
    buf.push(line);
    if (line.startsWith("}")) {
      try {
        reports.push(JSON.parse(buf.join("\n")));
      } catch {
        // A report cut by the log's own line limit: skip it rather than guess.
      }
      buf = undefined;
    }
  }
  return reports;
}

/**
 * One line per variant, then the timeline of every tab that scored above 0. A retried test prints
 * its report again: the last one per variant is kept.
 */
export function formatCls(reports) {
  const byVariant = new Map();
  for (const r of reports) {
    byVariant.set([r.project, `motion ${r.motion}`, r.slowSinceYesterday ? "slow history" : ""].filter(Boolean).join(", "), r);
  }
  const lines = [];
  for (const [variant, r] of byVariant) {
    const scores = Object.entries(r.scores ?? {}).map(([tab, v]) => `${tab} ${Number(v).toFixed(3)}`);
    lines.push(`${variant}: ${scores.join(" · ")}`);
    for (const [tab, v] of Object.entries(r.scores ?? {})) {
      if (v > 0) for (const step of r.timelines?.[tab] ?? []) lines.push(`    ${tab}: ${step}`);
    }
  }
  return lines;
}

/**
 * Sorts regenerated screenshots against the committed ones. `compare(actual, expected)` returns
 * null when they match within the threshold (Playwright's comparator does), or a message.
 */
export function classifyBaselines(regenerated, committed, compare) {
  const result = { added: [], changed: [], drift: [], identical: [] };
  for (const [name, actual] of regenerated) {
    const expected = committed.get(name);
    if (!expected) result.added.push(name);
    else if (actual.equals(expected)) result.identical.push(name);
    else if (compare(actual, expected)) result.changed.push(name);
    else result.drift.push(name);
  }
  return result;
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
}

function resolveSha(target) {
  if (/^\d+$/.test(target)) return gh(["pr", "view", target, "--json", "headRefOid", "--jq", ".headRefOid"]);
  if (/^[0-9a-f]{7,40}$/i.test(target)) return gh(["api", `repos/{owner}/{repo}/commits/${target}`, "--jq", ".sha"]);
  return gh(["api", `repos/{owner}/{repo}/branches/${encodeURIComponent(target)}`, "--jq", ".commit.sha"]);
}

function branchOf(target, sha) {
  if (/^\d+$/.test(target)) return gh(["pr", "view", target, "--json", "headRefName", "--jq", ".headRefName"]);
  if (/^[0-9a-f]{7,40}$/i.test(target)) throw new Error(`--dispatch needs a PR number or branch, not a SHA (${sha.slice(0, 7)})`);
  return target;
}

function runsFor(sha) {
  const json = gh(["run", "list", "--commit", sha, "-L", "50", "--json", "databaseId,name,event,status,conclusion"]);
  return JSON.parse(json);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits until the head has its CI and E2E runs and every run on it has finished. */
async function waitForRuns(sha, { needDispatch = false } = {}) {
  for (let waited = 0; ; waited += POLL_MS) {
    const runs = runsFor(sha);
    const names = new Set(runs.map((r) => r.name));
    const haveDispatch = runs.some((r) => r.name === "E2E" && r.event === "workflow_dispatch");
    const pending = runs.filter((r) => r.status !== "completed");
    const present = names.has("CI") && names.has("E2E") && (!needDispatch || haveDispatch);
    if (present && pending.length === 0) return runs;
    if (waited === 0 || waited % (5 * 60_000) === 0) {
      console.error(`waiting: ${pending.map((r) => r.name).join(", ") || "runs not created yet"} (${Math.round(waited / 60_000)} min)`);
    }
    await sleep(POLL_MS);
  }
}

function reportRuns(runs) {
  const latest = new Map();
  for (const r of runs) {
    const key = `${r.name}${r.event === "workflow_dispatch" ? " (dispatch)" : ""}`;
    if (!latest.has(key)) latest.set(key, r); // gh lists newest first
  }
  for (const [key, r] of latest) console.log(`${r.conclusion === "success" ? "ok  " : "FAIL"} ${key} ${r.conclusion} (run ${r.databaseId})`);
  return latest;
}

function reportE2e(run) {
  const log = gh(["run", "view", String(run.databaseId), "--log"]);
  const summary = parseSummary(log);
  if (summary.failed.length) console.log(`\nfailed (${summary.failed.length}):\n${summary.failed.map((t) => `  ${t}`).join("\n")}`);
  if (summary.flaky.length) console.log(`\nflaky (${summary.flaky.length}):\n${summary.flaky.map((t) => `  ${t}`).join("\n")}`);
  const snapshots = parseSnapshots(log);
  if (snapshots.length) console.log(`\nsnapshots that differ: ${snapshots.join(", ")}`);
  const cls = formatCls(parseClsReports(log));
  if (cls.length) console.log(`\ntab-switch CLS:\n${cls.map((l) => `  ${l}`).join("\n")}`);
}

function readPngs(dir) {
  const files = new Map();
  if (!existsSync(dir)) return files;
  for (const project of readdirSync(dir)) {
    const sub = join(dir, project);
    for (const f of readdirSync(sub).filter((n) => n.endsWith(".png"))) files.set(`${project}/${f}`, readFileSync(join(sub, f)));
  }
  return files;
}

/** Playwright's own PNG comparator, with the threshold from frontend/playwright.config.ts. */
function playwrightCompare() {
  // Not an exported subpath, so load it by file from the installed package.
  const require = createRequire(join(ROOT, "frontend", "package.json"));
  const { utils } = require(join(dirname(require.resolve("playwright-core")), "lib", "coreBundle.js"));
  if (typeof utils?.getComparator !== "function") throw new Error("playwright-core no longer exposes utils.getComparator; update e2e-report.mjs");
  const config = readFileSync(join(ROOT, "frontend", "playwright.config.ts"), "utf8");
  const maxDiffPixels = Number(config.match(/maxDiffPixels:\s*(\d+)/)?.[1] ?? 0);
  const compare = utils.getComparator("image/png");
  return (actual, expected) => compare(actual, expected, { maxDiffPixels })?.errorMessage ?? null;
}

async function baselines(sha, runs, apply) {
  const run = runs.find((r) => r.name === "E2E" && r.event === "workflow_dispatch" && r.conclusion === "success");
  if (!run) {
    console.log("\nno successful update_snapshots run on this head; rerun with --dispatch to start one");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "e2e-baselines-"));
  try {
    gh(["run", "download", String(run.databaseId), "-n", "playwright-baselines", "-D", dir]);
    const result = classifyBaselines(readPngs(dir), readPngs(SCREENSHOTS), playwrightCompare());
    console.log(`\nbaselines from run ${run.databaseId}:`);
    console.log(`  new:     ${result.added.join(", ") || "none"}`);
    console.log(`  changed: ${result.changed.join(", ") || "none"}`);
    console.log(`  drift within the threshold (left alone): ${result.drift.join(", ") || "none"}`);
    if (apply) {
      for (const name of [...result.added, ...result.changed]) {
        mkdirSync(dirname(join(SCREENSHOTS, name)), { recursive: true });
        copyFileSync(join(dir, name), join(SCREENSHOTS, name));
      }
      console.log(`  copied ${result.added.length + result.changed.length} into ${relative(ROOT, SCREENSHOTS)}; review them before committing`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(argv) {
  const target = argv.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("usage: npm run e2e:report -- <pr-number|branch|sha> [--baselines [--dispatch] [--apply]]");
    process.exit(2);
  }
  const wantBaselines = argv.includes("--baselines");
  const sha = resolveSha(target);
  console.log(`head ${sha.slice(0, 7)} (${target})`);
  if (wantBaselines && argv.includes("--dispatch")) {
    gh(["workflow", "run", "e2e.yml", "--ref", branchOf(target, sha), "-f", "update_snapshots=true"]);
    console.error("started an update_snapshots run");
    await sleep(10_000);
  }
  const runs = await waitForRuns(sha, { needDispatch: wantBaselines && argv.includes("--dispatch") });
  const latest = reportRuns(runs);
  // Read on a passing run too: the CLS report is useful either way.
  const e2e = latest.get("E2E");
  if (e2e && e2e.conclusion !== "skipped") reportE2e(e2e);
  if (wantBaselines) await baselines(sha, runs, argv.includes("--apply"));
  const failed = [...latest.values()].some((r) => !["success", "skipped", "neutral"].includes(r.conclusion));
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(2);
  });
}
