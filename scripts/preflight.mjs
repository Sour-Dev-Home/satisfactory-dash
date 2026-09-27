// Pre-push preflight (#287): run `npm run preflight` before every push. It catches, locally and in about a second, the
// things that otherwise cost a CI round or a review round:
//   1. the PR for this branch is still OPEN and not CONFLICTING (a merged PR must not be pushed to; branch fresh from main);
//   2. the diff against origin/main (committed and uncommitted) and the commit messages hold no local absolute path
//      (C:\Users..., /home/..., /Users/...) and none of the identifiers listed in PREFLIGHT_PATTERNS_FILE (an optional,
//      git-ignored file, one fixed string per line; the real list lives in CI's PII_PATTERNS secret, not here);
//   3. this worktree has its node_modules (a fresh worktree has none, and typecheck/tests then fail confusingly).
// It never prints the matched text of a private pattern, only the file and line.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The path shapes CI's PII scan rejects, built from parts so this file does not contain them literally. */
export const PATH_PATTERNS = [["C:", "\\Users"].join(""), ["C:", "/Users"].join(""), ["/", "home", "/"].join(""), ["/", "Users", "/"].join("")];

/** Files that legitimately talk about these patterns (this script and its test); the license names the copyright holder. */
export const SCAN_EXEMPT = [/^scripts\/preflight(\.test)?\.mjs$/, /^LICENSE$/];

/**
 * @param {string} diff unified diff (`git diff -U0`)
 * @returns {{ file: string; line: number; text: string }[]} the added lines, with the new file's line number
 */
export function addedLines(diff) {
  const out = [];
  let file = "";
  let line = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.startsWith("+++ b/") ? raw.slice(6) : "";
    } else if (raw.startsWith("@@")) {
      const match = /\+(\d+)/.exec(raw);
      line = match ? Number(match[1]) : 0;
    } else if (raw.startsWith("+") && file !== "") {
      out.push({ file, line, text: raw.slice(1) });
      line += 1;
    } else if (raw.startsWith(" ")) {
      line += 1; // a context line (absent with -U0, but harmless to count)
    }
  }
  return out;
}

/**
 * @param {{ file: string; line: number; text: string }[]} lines
 * @param {string[]} patterns fixed strings, matched case-insensitively
 * @returns {{ file: string; line: number; pattern: number }[]} pattern is an index, never the text
 */
export function scanLines(lines, patterns) {
  const lowered = patterns.map((pattern) => pattern.toLowerCase());
  const hits = [];
  for (const { file, line, text } of lines) {
    if (SCAN_EXEMPT.some((exempt) => exempt.test(file))) continue;
    const haystack = text.toLowerCase();
    lowered.forEach((pattern, index) => {
      if (pattern !== "" && haystack.includes(pattern)) hits.push({ file, line, pattern: index });
    });
  }
  return hits;
}

/** @param {string} message the commit messages joined */
export function scanMessages(message, patterns) {
  return scanLines(
    message.split("\n").map((text, index) => ({ file: "(commit message)", line: index + 1, text })),
    patterns,
  );
}

/**
 * @param {{ state: string; mergeable: string } | undefined} pr `gh pr view --json state,mergeable`, undefined when the branch has no PR
 * @returns {string[]} problems
 */
export function checkPr(pr) {
  if (pr === undefined) return [];
  const problems = [];
  if (pr.state !== "OPEN") {
    problems.push(`The PR for this branch is ${pr.state}, not OPEN: do not push to it. Branch fresh from origin/main.`);
  } else if (pr.mergeable === "CONFLICTING") {
    problems.push("The PR is CONFLICTING with main: rebase or merge origin/main and resolve it before pushing.");
  }
  return problems;
}

/** @param {string[]} entries the names in the worktree's node_modules directory ([] when it does not exist) */
export function checkNodeModules(entries) {
  return entries.length === 0
    ? ["This worktree has no node_modules: run `npm ci` here (or the checks below will fail for the wrong reason)."]
    : [];
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readPatternsFile(file) {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function prForBranch() {
  try {
    const json = execFileSync("gh", ["pr", "view", "--json", "state,mergeable"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(json);
  } catch {
    return undefined; // no PR yet (or gh unavailable): nothing to check
  }
}

function main() {
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(root);
  const problems = [];

  problems.push(...checkPr(prForBranch()));

  const patterns = [...PATH_PATTERNS, ...readPatternsFile(process.env.PREFLIGHT_PATTERNS_FILE)];
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter((file) => file !== "")
    .flatMap((file) => {
      try {
        return readFileSync(file, "utf8")
          .split("\n")
          .map((text, index) => ({ file, line: index + 1, text }));
      } catch {
        return []; // unreadable (a directory or a vanished file): nothing to scan
      }
    });
  const lines = [
    ...addedLines(git(["diff", "-U0", "--no-color", "origin/main...HEAD"])),
    ...addedLines(git(["diff", "-U0", "--no-color", "HEAD"])),
    ...untracked,
  ];
  const hits = [...scanLines(lines, patterns), ...scanMessages(git(["log", "--format=%B", "origin/main..HEAD"]), patterns)];
  for (const hit of hits) {
    const what = hit.pattern < PATH_PATTERNS.length ? "a local absolute path" : "a private identifier (PREFLIGHT_PATTERNS_FILE)";
    problems.push(`${hit.file}:${hit.line} contains ${what}. Remove it before pushing.`);
  }

  problems.push(...checkNodeModules(existsSync(path.join(root, "node_modules")) ? readdirSync(path.join(root, "node_modules")) : []));

  if (problems.length === 0) {
    console.log("preflight: ok");
    return;
  }
  for (const problem of problems) console.error(`preflight: ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
