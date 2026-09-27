// The test-hunter log (#341): one fragment per PR's hunter work in docs-vault/wiki/hunter-log.d/, so the
// FULL/QUICK/skip tiers can be tuned on evidence. Counts and PR numbers only, no personal data.
//
//   npm run hunter-report               runs, median tokens, bugs per run and 0-bug share, by tier and area
//   npm run hunter-report -- --template print a fragment to fill in (name it <YYYY-MM-DD>-<pr>.md)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HUNTER_LOG_DIR = path.join(root, "docs-vault", "wiki", "hunter-log.d");

/** `<YYYY-MM-DD>-<pr>.md`, or `-<pr>-<n>.md` for a second fragment for the same PR that day. */
export const RUN_NAME = /^\d{4}-\d{2}-\d{2}-\d+(-\d+)?\.md$/;
export const TIERS = ["FULL", "QUICK"];
export const AREAS = ["backend", "frontend", "shared", "game-adapter", "agent", "ci"];
/** Every field a fragment has, as `- key: value` lines. Numbers are totals over the PR's rounds. */
const NUMBERS = ["pr", "minutes", "tokens", "bugs", "fixed", "tests", "rounds"];
/** After this many runs of one tier and area with no real bug, propose a downgrade (the owner's rule). */
export const DOWNGRADE_AFTER = 8;

export function template() {
  return [
    "- pr: <number>",
    `- tier: <${TIERS.join(" | ")}>`,
    `- area: <${AREAS.join(" | ")}>`,
    "- minutes: <wall clock, all rounds>",
    "- tokens: <subagent total_tokens, all rounds>",
    "- bugs: <real bugs found>",
    "- fixed: <of those, fixed in the PR>",
    "- tests: <tests the hunter added>",
    "- rounds: <hunter runs until it found nothing>",
    "",
  ].join("\n");
}

/** One fragment's fields; throws with the file name on anything missing or malformed. */
export function parseRun(text, name = "fragment") {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^-\s*([a-z-]+):\s*(.+?)\s*$/.exec(line);
    if (match) fields[match[1]] = match[2];
  }
  const run = {};
  for (const key of NUMBERS) {
    const value = Number(fields[key]);
    if (fields[key] === undefined || !Number.isFinite(value) || value < 0) {
      throw new Error(`${name}: "${key}" must be a number of 0 or more (got ${fields[key] ?? "nothing"})`);
    }
    run[key] = value;
  }
  if (!TIERS.includes(fields.tier)) throw new Error(`${name}: "tier" must be one of ${TIERS.join(", ")} (got ${fields.tier ?? "nothing"})`);
  if (!AREAS.includes(fields.area)) throw new Error(`${name}: "area" must be one of ${AREAS.join(", ")} (got ${fields.area ?? "nothing"})`);
  if (run.fixed > run.bugs) throw new Error(`${name}: "fixed" (${run.fixed}) is more than "bugs" (${run.bugs})`);
  if (run.rounds < 1) throw new Error(`${name}: "rounds" must be at least 1`);
  return { ...run, tier: fields.tier, area: fields.area };
}

/** Every fragment in `dir`, parsed, in file-name order. The README is not a fragment. */
export function readRuns(dir = HUNTER_LOG_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => RUN_NAME.test(name))
    .sort()
    .map((name) => ({ name, ...parseRun(readFileSync(path.join(dir, name), "utf8"), name) }));
}

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One row per tier and area that has runs, FULL first, then by area. */
export function summarise(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = `${run.tier} ${run.area}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  const order = (row) => TIERS.indexOf(row.tier) * AREAS.length + AREAS.indexOf(row.area);
  return [...groups.values()]
    .map((group) => {
      const bugs = group.reduce((sum, run) => sum + run.bugs, 0);
      return {
        tier: group[0].tier,
        area: group[0].area,
        runs: group.length,
        medianTokens: median(group.map((run) => run.tokens)),
        medianMinutes: median(group.map((run) => run.minutes)),
        bugsPerRun: bugs / group.length,
        zeroBugShare: group.filter((run) => run.bugs === 0).length / group.length,
        downgrade: bugs === 0 && group.length >= DOWNGRADE_AFTER,
      };
    })
    .sort((a, b) => order(a) - order(b));
}

export function formatReport(runs) {
  if (runs.length === 0) return "No hunter runs logged yet (docs-vault/wiki/hunter-log.d/).\n";
  const rows = summarise(runs);
  const lines = [
    `${runs.length} hunter run(s)`,
    "",
    "tier   area          runs  median tokens  median min  bugs/run  0-bug share",
    ...rows.map(
      (row) =>
        `${row.tier.padEnd(6)} ${row.area.padEnd(13)} ${String(row.runs).padStart(4)}  ${String(Math.round(row.medianTokens)).padStart(13)}  ${row.medianMinutes.toFixed(1).padStart(10)}  ${row.bugsPerRun.toFixed(2).padStart(8)}  ${`${Math.round(row.zeroBugShare * 100)}%`.padStart(11)}`,
    ),
  ];
  const candidates = rows.filter((row) => row.downgrade);
  if (candidates.length > 0) {
    lines.push("", `Downgrade candidates (0 real bugs in ${DOWNGRADE_AFTER}+ runs):`);
    for (const row of candidates) lines.push(`  ${row.tier} ${row.area}: ${row.runs} runs`);
  }
  return `${lines.join("\n")}\n`;
}

function main(args) {
  if (args.includes("--template")) {
    process.stdout.write(template());
    return;
  }
  process.stdout.write(formatReport(readRuns()));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
