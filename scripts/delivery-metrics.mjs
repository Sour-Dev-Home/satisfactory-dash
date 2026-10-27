#!/usr/bin/env node
// Delivery metrics (#280), DORA-style, plus CI health (ADR-0056 PR 6a), from the GitHub API and the log.d fragments.
// AGGREGATES ONLY: no login, email, commit message, PR title, branch or SHA ever reaches the report. The normalisers
// below drop every string except dates and a few booleans; commit SHAs are kept in memory only as join keys and never
// written out. The JSON is the body of `POST /api/internal/metrics/delivery` and must parse with
// `DeliverySnapshotSchema` (packages/shared/src/metrics.ts); the markdown is derived from it.
//
//   npm run delivery-metrics                      # last 30 days, markdown on stdout
//   npm run delivery-metrics -- --days 7 --json   # JSON on stdout
//   npm run delivery-metrics -- --out <dir>       # writes delivery-metrics.json and delivery-metrics.md there
//
// JSON shape (schemaVersion 2; every number is a plain number, every date an ISO-8601 UTC string):
//   { schemaVersion, generatedAt, window: { days, from, to },
//     throughput:    { mergedPrs, perDay, perWeek: [{ weekStart, merged }] },
//     leadTimeHours: { median, p90, mean },                 // PR opened -> merged; null when nothing merged
//     size:          { medianLinesChanged },                // additions + deletions per merged PR; null when nothing merged
//     changeFailure: { mainRuns, failedMainRuns, failureRate, revertPrs, revertRate },
//     ci:            { mainRuns, failedMainRuns, mainFailureRate, flakyRuns, flakeRate, prsMerged, prsBounced, bounceRate },
//     logFragments:  { inWindow } }
// Version 1 had a `mergeQueue` section; ADR-0043 removed the merge queue and ADR-0056 section 4 (lines 92-96) dropped it.
//
// Definitions and limits (also in docs-vault/wiki/runbooks/delivery-metrics.md):
// - Lead time is PR created -> merged, not first commit -> merged (a draft counts from when it was opened).
// - Change failure signals are proxies: failed CI runs on push to main, and merged PRs whose title starts with "Revert".
// - Flaky run and bounced PR: see `flakeStats` and `bounceStats` (ADR-0056 lines 94-95).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 2;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRAGMENT_DIR = join(ROOT, "docs-vault", "wiki", "log.d");
const FRAGMENT_NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]*\.md$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The workflows that report the required checks (verify and security in ci.yml, e2e in e2e.yml). */
export const CI_WORKFLOWS = ["ci.yml", "e2e.yml"];
/** Conclusions that count as a failed attempt or a failed check. Cancelled, skipped and neutral are not failures. */
const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
const SHA = /^[0-9a-f]{40}$/;

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const inWindow = (iso, from, now) => new Date(iso) >= from && new Date(iso) <= now;

/** Linear-interpolated percentile of a numeric array (p in 0..1); null for an empty one. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** Monday 00:00 UTC of the week that contains the instant, as ISO text. */
export function weekStart(iso) {
  const date = new Date(iso);
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - dayOfWeek)).toISOString();
}

/**
 * The ONLY place a GraphQL pull request node is read. Everything except numbers, dates, a boolean and the commit SHAs
 * (in-memory join keys for the bounce rate, never output) is dropped here (author, title, body, URL...).
 * @returns {{ createdAt: string; mergedAt: string; linesChanged: number; isRevert: boolean; commitShas: string[] } | undefined}
 */
export function normalizePr(node) {
  if (!node || typeof node.createdAt !== "string" || typeof node.mergedAt !== "string") return undefined;
  const commits = node.commits?.nodes ?? [];
  return {
    createdAt: node.createdAt,
    mergedAt: node.mergedAt,
    linesChanged: (Number(node.additions) || 0) + (Number(node.deletions) || 0),
    isRevert: typeof node.title === "string" && /^revert\b/i.test(node.title),
    commitShas: commits.map((entry) => entry?.commit?.oid).filter((oid) => typeof oid === "string" && SHA.test(oid)),
  };
}

/**
 * The ONLY place a workflow run is read (one `gh run list` row, plus its earlier attempts from the attempts API). The
 * branch is reduced to a boolean and the SHA is kept only as an in-memory grouping key.
 * @param {{ attempt?: number; conclusion?: string; createdAt: string; startedAt?: string; headSha?: string; event?: string; headBranch?: string }} run
 * @param {string} workflow one of CI_WORKFLOWS
 * @param {{ conclusion?: string | null; run_started_at?: string; run_attempt?: number }[]} earlierAttempts
 * @returns {{ workflow: string; sha: string; createdAt: string; conclusion: string; onMainPush: boolean; attempts: { conclusion: string; at: string; n: number }[] }}
 */
export function normalizeRun(run, workflow, earlierAttempts = []) {
  const latest = { conclusion: run.conclusion ?? "", at: run.startedAt ?? run.createdAt, n: Number(run.attempt) || 1 };
  const earlier = earlierAttempts
    .filter((attempt) => typeof attempt?.run_started_at === "string" && Number(attempt.run_attempt) < latest.n)
    .map((attempt) => ({ conclusion: attempt.conclusion ?? "", at: attempt.run_started_at, n: Number(attempt.run_attempt) }));
  return {
    workflow,
    sha: typeof run.headSha === "string" ? run.headSha : "",
    createdAt: run.createdAt,
    conclusion: latest.conclusion,
    onMainPush: run.event === "push" && run.headBranch === "main",
    attempts: [...earlier, latest].sort((a, b) => a.n - b.n),
  };
}

/** A run whose latest attempt finished as a success or a failure; cancelled, skipped and running runs are not counted. */
const completed = (run) => run.conclusion === "success" || FAILED.has(run.conclusion);

/**
 * Flake rate, ADR-0056 section 4 (docs-vault/wiki/decisions/0056-metrics-page-build.md line 94): "a flaky run is a CI
 * run whose head SHA has a failed attempt and a later successful attempt".
 * - A CI run is one run of a workflow in CI_WORKFLOWS, created in the window, whose latest attempt succeeded or failed.
 * - Attempts are grouped by workflow and head SHA: a run's own re-run attempts and any other run of the same workflow on
 *   the same SHA. Within a group, ordered by start time, the first successful attempt that follows a failed one marks its
 *   run as flaky. So a group adds at most one flaky run, and a run that failed and was never rerun green is not flaky.
 * - flakeRate = flakyRuns / CI runs; null when there are none.
 */
export function flakeStats(ciRuns) {
  const runs = ciRuns.filter(completed);
  const groups = new Map();
  runs.forEach((run, index) => {
    const key = run.sha === "" ? `#${index}` : `${run.workflow}\u0000${run.sha}`; // no SHA: the run stands alone
    if (!groups.has(key)) groups.set(key, []);
    for (const attempt of run.attempts) groups.get(key).push({ ...attempt, index });
  });
  let flaky = 0;
  for (const attempts of groups.values()) {
    attempts.sort((a, b) => a.at.localeCompare(b.at) || a.index - b.index || a.n - b.n);
    let failedBefore = false;
    for (const attempt of attempts) {
      if (FAILED.has(attempt.conclusion)) failedBefore = true;
      else if (attempt.conclusion === "success" && failedBefore) {
        flaky += 1;
        break;
      }
    }
  }
  return { runs: runs.length, flaky };
}

/**
 * Bounce rate, ADR-0056 section 4 (line 95): "a bounced PR is a merged PR whose required checks failed at least once
 * before the merge". A merged PR in the window bounced when any of its commits has a failed required check run (any
 * attempt) that completed before `mergedAt`. bounceRate = prsBounced / prsMerged; null when nothing merged.
 * @param {ReturnType<typeof normalizePr>[]} merged
 * @param {Map<string, string[]>} failedChecks commit SHA -> completion times of its failed required check runs
 */
export function bounceStats(merged, failedChecks) {
  const bounced = merged.filter((pr) =>
    pr.commitShas.some((sha) => (failedChecks.get(sha) ?? []).some((at) => new Date(at) < new Date(pr.mergedAt))),
  );
  return { merged: merged.length, bounced: bounced.length };
}

/**
 * The required status check names from `GET /repos/{owner}/{repo}/rules/branches/main`, sorted.
 * @param {unknown} rules
 */
export function requiredCheckNames(rules) {
  if (!Array.isArray(rules)) throw new Error("GitHub returned unexpected branch rules");
  const names = new Set();
  for (const rule of rules) {
    if (rule?.type !== "required_status_checks") continue;
    for (const check of rule.parameters?.required_status_checks ?? []) {
      if (typeof check?.context === "string") names.add(check.context);
    }
  }
  return [...names].sort();
}

/**
 * Completion times of the failed required check runs in `--paginate --slurp` pages of
 * `GET /repos/{owner}/{repo}/commits/{sha}/check-runs?filter=all`. Names and everything else are dropped.
 * @param {unknown} pages
 * @param {string[]} required
 */
export function failedRequiredCheckTimes(pages, required) {
  if (!Array.isArray(pages)) throw new Error("GitHub returned unexpected check runs");
  const names = new Set(required);
  return pages
    .flatMap((page) => (Array.isArray(page?.check_runs) ? page.check_runs : []))
    .filter((check) => names.has(check?.name) && FAILED.has(check?.conclusion) && typeof check?.completed_at === "string")
    .map((check) => check.completed_at)
    .sort();
}

/**
 * @param {{ prs: ReturnType<typeof normalizePr>[]; ciRuns: ReturnType<typeof normalizeRun>[]; failedChecks?: Map<string, string[]>; fragmentDates: string[]; now: Date; days: number }} input
 */
export function buildReport({ prs, ciRuns, failedChecks = new Map(), fragmentDates, now, days }) {
  const from = new Date(now.getTime() - days * DAY_MS);
  const merged = prs.filter((pr) => pr !== undefined && inWindow(pr.mergedAt, from, now));
  const leadHours = merged.map((pr) => (new Date(pr.mergedAt) - new Date(pr.createdAt)) / HOUR_MS);

  const weeks = new Map();
  for (const pr of merged) {
    const key = weekStart(pr.mergedAt);
    weeks.set(key, (weeks.get(key) ?? 0) + 1);
  }

  const windowRuns = ciRuns.filter((run) => inWindow(run.createdAt, from, now));
  const mainRuns = windowRuns.filter((run) => run.workflow === "ci.yml" && run.onMainPush && completed(run));
  const failedRuns = mainRuns.filter((run) => FAILED.has(run.conclusion)).length;
  const reverts = merged.filter((pr) => pr.isRevert).length;
  const flakes = flakeStats(windowRuns);
  const bounces = bounceStats(merged, failedChecks);

  const ratio = (numerator, denominator) => (denominator === 0 ? null : round(numerator / denominator, 3));
  const stat = (values, fn) => (values.length === 0 ? null : round(fn(values)));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    window: { days, from: from.toISOString(), to: now.toISOString() },
    throughput: {
      mergedPrs: merged.length,
      perDay: round(merged.length / days, 2),
      perWeek: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, count]) => ({ weekStart: start, merged: count })),
    },
    leadTimeHours: {
      median: stat(leadHours, (v) => percentile(v, 0.5)),
      p90: stat(leadHours, (v) => percentile(v, 0.9)),
      mean: stat(leadHours, (v) => v.reduce((sum, x) => sum + x, 0) / v.length),
    },
    size: { medianLinesChanged: stat(merged.map((pr) => pr.linesChanged), (v) => percentile(v, 0.5)) },
    changeFailure: {
      mainRuns: mainRuns.length,
      failedMainRuns: failedRuns,
      failureRate: ratio(failedRuns, mainRuns.length),
      revertPrs: reverts,
      revertRate: ratio(reverts, merged.length),
    },
    ci: {
      mainRuns: mainRuns.length,
      failedMainRuns: failedRuns,
      mainFailureRate: ratio(failedRuns, mainRuns.length),
      flakyRuns: flakes.flaky,
      flakeRate: ratio(flakes.flaky, flakes.runs),
      prsMerged: bounces.merged,
      prsBounced: bounces.bounced,
      bounceRate: ratio(bounces.bounced, bounces.merged),
    },
    logFragments: { inWindow: fragmentDates.filter((date) => inWindow(`${date}T00:00:00Z`, from, now)).length },
  };
}

const show = (value, suffix = "") => (value === null ? "n/a" : `${value}${suffix}`);
const percent = (value) => (value === null ? "n/a" : `${round(value * 100)}%`);

/** The markdown summary, derived from the JSON report alone. */
export function renderMarkdown(report) {
  const { window: w, throughput: t, leadTimeHours: l, size, changeFailure: c, ci, logFragments: f } = report;
  return [
    `# Delivery metrics (${w.days} days to ${w.to.slice(0, 10)})`,
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Merged PRs | ${t.mergedPrs} (${t.perDay} per day) |`,
    `| Lead time, PR opened to merged | median ${show(l.median, " h")}, p90 ${show(l.p90, " h")}, mean ${show(l.mean, " h")} |`,
    `| Median change size | ${show(size.medianLinesChanged, " lines")} |`,
    `| Failed CI runs on main | ${percent(c.failureRate)} (${c.failedMainRuns} of ${c.mainRuns}) |`,
    `| Revert PRs | ${c.revertPrs} (${percent(c.revertRate)} of merged) |`,
    `| Flaky CI runs | ${percent(ci.flakeRate)} (${ci.flakyRuns}) |`,
    `| Bounced PRs | ${percent(ci.bounceRate)} (${ci.prsBounced} of ${ci.prsMerged}) |`,
    `| Log fragments | ${f.inWindow} |`,
    "",
    "Merged per week (week starting Monday, UTC):",
    "",
    ...(t.perWeek.length === 0 ? ["none"] : t.perWeek.map((week) => `- ${week.weekStart.slice(0, 10)}: ${week.merged}`)),
    "",
    "Aggregates only. Lead time is PR opened to merged; failed runs and revert PRs are proxies for change failure.",
    "A flaky run failed and later passed on the same commit; a bounced PR had a required check fail before its merge.",
    "",
  ].join("\n");
}

// ---- GitHub access (not unit-tested: drives `gh`) ----

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** Parses `gh api` JSON without ever echoing raw API text in an error (JSON.parse messages quote the input). */
function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GitHub returned ${what} that is not JSON`);
  }
}

// The last 50 commits per PR are read for the bounce rate; a PR with more commits than that is judged on its last 50.
const PR_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 50, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt mergedAt updatedAt additions deletions title
        commits(last: 50) { nodes { commit { oid } } }
      }
    }
  }
}`;

function repoSlug() {
  const [owner, name] = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim().split("/");
  return { owner, name };
}

/** Parses a GraphQL response without ever echoing raw API text in an error (JSON.parse messages quote the input). */
export function parseGraphql(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("GitHub returned a response that is not JSON");
  }
  const page = body?.data?.repository?.pullRequests;
  if (!page || !Array.isArray(page.nodes) || typeof page.pageInfo?.hasNextPage !== "boolean") {
    throw new Error("GitHub returned an unexpected GraphQL response");
  }
  return page;
}

function fetchMergedPrs({ owner, name }, from) {
  const prs = [];
  const seen = new Set();
  let cursor = null;
  for (;;) {
    const args = ["api", "graphql", "-f", `query=${PR_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`];
    if (cursor !== null) args.push("-F", `cursor=${cursor}`);
    const page = parseGraphql(gh(args));
    // A PR updated while paging can shift onto the next page: count each PR number once.
    for (const node of page.nodes) {
      if (seen.has(node.number)) continue;
      seen.add(node.number);
      prs.push(normalizePr(node));
    }
    // Ordered by update time: once a whole page was last touched before the window, nothing older can have merged inside it.
    const stale = page.nodes.length > 0 && page.nodes.every((node) => new Date(node.updatedAt) < from);
    if (!page.pageInfo.hasNextPage || stale) return prs;
    cursor = page.pageInfo.endCursor;
  }
}

const RUN_FIELDS = "attempt,conclusion,createdAt,startedAt,databaseId,headSha,event,headBranch";

/**
 * Every run of the CI workflows created since `since` (at most 5000 per workflow), with the earlier attempts of re-run
 * runs. `since` reaches back to the oldest merged PR's opening, so its check failures are in the list.
 */
function fetchCiRuns({ owner, name }, since) {
  const runs = [];
  for (const workflow of CI_WORKFLOWS) {
    const list = parseJson(gh(["run", "list", "--workflow", workflow, "--created", `>=${since.toISOString().slice(0, 10)}`, "--limit", "5000", "--json", RUN_FIELDS]), "a run list");
    for (const run of list) {
      const earlier = [];
      for (let n = 1; n < (Number(run.attempt) || 1); n += 1) {
        earlier.push(parseJson(gh(["api", `repos/${owner}/${name}/actions/runs/${run.databaseId}/attempts/${n}`]), "a run attempt"));
      }
      runs.push(normalizeRun(run, workflow, earlier));
    }
  }
  return runs;
}

/**
 * Failed required check times per commit, looked up only for the merged PRs' commits that had a failed CI attempt (a
 * failed required check always fails its workflow run's attempt, so other commits cannot have one).
 */
function fetchFailedChecks({ owner, name }, merged, ciRuns) {
  const required = requiredCheckNames(parseJson(gh(["api", `repos/${owner}/${name}/rules/branches/main`]), "branch rules"));
  if (required.length === 0) throw new Error("main has no required status checks; the bounce rate needs them");
  const failedShas = new Set(ciRuns.filter((run) => run.attempts.some((a) => FAILED.has(a.conclusion))).map((run) => run.sha));
  const candidates = [...new Set(merged.flatMap((pr) => pr.commitShas))].filter((sha) => failedShas.has(sha)).sort();
  const failedChecks = new Map();
  for (const sha of candidates) {
    const pages = parseJson(gh(["api", "--paginate", "--slurp", `repos/${owner}/${name}/commits/${sha}/check-runs?filter=all&per_page=100`]), "check runs");
    failedChecks.set(sha, failedRequiredCheckTimes(pages, required));
  }
  return failedChecks;
}

function fragmentDates() {
  if (!existsSync(FRAGMENT_DIR)) return [];
  return readdirSync(FRAGMENT_DIR)
    .map((file) => FRAGMENT_NAME.exec(file)?.[1])
    .filter((date) => date !== undefined);
}

export function parseArgs(argv) {
  const options = { days: 30, json: false, out: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--json") options.json = true;
    else if (argv[i] === "--days") {
      const value = argv[i + 1] ?? "";
      if (!value.startsWith("--")) i += 1;
      options.days = /^\d+$/.test(value) ? Number(value) : Number.NaN;
    }
    else if (argv[i] === "--out") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error("--out needs a directory");
      options.out = value;
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 365) throw new Error("--days must be a whole number from 1 to 365");
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const now = new Date();
  const from = new Date(now.getTime() - options.days * DAY_MS);
  const repo = repoSlug();
  const prs = fetchMergedPrs(repo, from);
  const merged = prs.filter((pr) => pr !== undefined && inWindow(pr.mergedAt, from, now));
  const since = new Date(Math.min(from.getTime(), ...merged.map((pr) => new Date(pr.createdAt).getTime())));
  const ciRuns = fetchCiRuns(repo, since);
  const failedChecks = fetchFailedChecks(repo, merged, ciRuns);
  const report = buildReport({ prs, ciRuns, failedChecks, fragmentDates: fragmentDates(), now, days: options.days });
  if (options.out !== undefined) {
    mkdirSync(options.out, { recursive: true });
    writeFileSync(join(options.out, "delivery-metrics.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(options.out, "delivery-metrics.md"), renderMarkdown(report));
    console.log(`Wrote delivery-metrics.json and delivery-metrics.md to ${options.out}`);
  } else {
    console.log(options.json ? JSON.stringify(report, null, 2) : renderMarkdown(report));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
