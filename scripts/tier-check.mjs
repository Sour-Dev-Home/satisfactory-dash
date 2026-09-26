// CI check for ADR-0033 amendment 3 (runs in the `verify` job, on pull_request events only): a PR labelled `tier:ui`
// skips the architect's review, so CI decides whether it really is a UI-tier PR. It fails when the diff breaks either rule:
//   1. every changed file is in the UI-tier paths (below), and
//   2. no line ADDED under frontend/src matches the data-flow pattern (below).
// A PR without the label is not checked: it goes through the normal review. The label cannot be used to escape a review.
//
// Inputs come from the environment (no untrusted text is ever put in a shell line):
//   PR_FILES_FILE  path of a JSON file with the PR's changed files as the GitHub API returns them:
//                  [{ filename, status, previous_filename?, patch?, changes? }]. A file, not a variable: patches can
//                  exceed the size of one environment variable.
//   PR_LABELS_JSON the PR's label names: ["..."]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UI_TIER_LABEL = "tier:ui";
/** GitHub's "list pull request files" returns at most this many files. */
export const MAX_FILES_LISTED = 3000;

/** Paths that need the architect even inside frontend/src (data access, auth, the demo backend, the test browser setup). */
const FRONTEND_SRC_EXCLUDED = [/^frontend\/src\/api\//, /^frontend\/src\/auth\//, /^frontend\/src\/demo\/handlers\.ts$/, /^frontend\/src\/test\/browser\.ts$/];
const FRONTEND_SRC_FILE = /^frontend\/src\/.+\.(ts|tsx|css)$/;
const FRONTEND_SRC = "frontend/src/";
const E2E = /^frontend\/e2e\/.+/;
const LOG_FRAGMENTS = /^docs-vault\/wiki\/log\.d\/.+/;

/**
 * The data-flow pattern of amendment 3: an added line under frontend/src that contains any of these is not UI work.
 * The first thirteen are the amendment's own list; the architect's follow-up (2026-09-26) added the four browser network
 * APIs, and `fetch(` became a regex (below) so `fetch (` and `fetch\t(` count too.
 */
export const DATA_FLOW = [
  "useQuery",
  "useInfiniteQuery",
  "useMutation",
  "queryOptions",
  "apiSend",
  "apiGet",
  "endpoints.",
  "localStorage",
  "sessionStorage",
  "document.cookie",
  "indexedDB",
  "postMessage",
  "dangerouslySetInnerHTML",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
];

/** `fetch` followed by optional whitespace and `(`: the call, however it is spaced (`refetch(` is data flow too). */
const FETCH_CALL = /fetch\s*\(/;
/** The data layer's package: any added line that names it. */
const QUERY_PACKAGE = "@tanstack/react-query";
/** An added line that imports (static, re-export, dynamic or require) from a module specifier with an `/api` or `/auth`
 *  path segment: `"../api/client"`, `"@/auth/session"`, `"./api"`. Only import-shaped lines, so a string that merely holds
 *  a URL is not caught here (the fetch that would use it is). */
const IMPORT_LINE = /\b(from|import|require)\b/;
const API_OR_AUTH_SPECIFIER = /["'`][^"'`\n]*\/(api|auth)(\/[^"'`\n]*)?["'`]/;

/**
 * What in an added line makes it data-flow code, or undefined. Literal token, `fetch(` regex, the query package, and
 * imports of an api/auth path.
 *
 * ACCEPTED LIMITS (ADR-0033 amendment 3, architect's ruling): this stops an honest author from misclassifying a PR, not a
 * malicious one. A token split across lines or built by string concatenation (`window["fe" + "tch"]`), a different case,
 * or a symlink added as a `.ts` file (its patch is only the target path) is not seen. The label never replaces the
 * architect's review of a PR someone means to smuggle past it; that is what code ownership and the merge queue are for.
 */
export function dataFlowHit(line) {
  const token = DATA_FLOW.find((pattern) => line.includes(pattern));
  if (token !== undefined) return token;
  if (FETCH_CALL.test(line)) return "fetch(";
  if (line.includes(QUERY_PACKAGE)) return QUERY_PACKAGE;
  if (IMPORT_LINE.test(line) && API_OR_AUTH_SPECIFIER.test(line)) return "an import from an api/ or auth/ path";
  return undefined;
}

/** True when a changed path is inside the UI tier's paths. Anything with a ".." segment is refused outright. */
export function isUiTierPath(file) {
  if (file.split("/").includes("..")) return false;
  if (FRONTEND_SRC_FILE.test(file)) return !FRONTEND_SRC_EXCLUDED.some((excluded) => excluded.test(file));
  return E2E.test(file) || LOG_FRAGMENTS.test(file);
}

/** The lines a unified-diff patch adds (without the leading "+"). A GitHub patch has no "+++" file header, so a "+++x" line is an added "++x". */
export function addedLines(patch) {
  return patch
    .split("\n")
    .filter((line) => line.startsWith("+"))
    .map((line) => line.slice(1));
}

/**
 * @param {{ files: { filename: string; status: string; previous_filename?: string | null; patch?: string; changes?: number }[]; labels: string[] }} pr
 * @returns {{ ok: boolean; skipped?: string; problems: string[] }}
 */
export function checkTier({ files, labels }) {
  if (!labels.includes(UI_TIER_LABEL)) return { ok: true, skipped: `no ${UI_TIER_LABEL} label`, problems: [] };

  // The API lists at most 3000 files of a PR: a list that long may be cut short, and what is not seen cannot be vouched for.
  if (files.length >= MAX_FILES_LISTED) {
    return {
      ok: false,
      problems: [`Cannot verify the UI tier: the PR has ${MAX_FILES_LISTED} or more changed files, more than the API lists. Not a UI-tier PR, request architect review.`],
    };
  }
  const outside = [];
  const dataFlow = [];
  const unreadable = [];
  // File names come from the PR and end up in a `::error::` line: anything but printable ASCII (a newline could start a
  // second workflow command) is replaced.
  const safe = (name) => name.replace(/[^\x20-\x7e]/g, "?");
  for (const { filename, status, previous_filename: previous, patch, changes } of files) {
    // A rename touches the old path too: moving a file out of a protected path is an edit of that path.
    for (const touched of [filename, ...(previous ? [previous] : [])]) {
      if (!isUiTierPath(touched)) outside.push(safe(touched));
    }
    if (!filename.startsWith(FRONTEND_SRC) || status === "removed") continue;
    if (patch == null) {
      // A pure rename or mode change has no patch and no added lines; anything else without a patch (a diff too large for
      // the API to include) cannot be read, so it fails closed.
      if (!(status === "renamed" && changes === 0)) unreadable.push(safe(filename));
      continue;
    }
    const lines = addedLines(patch);
    for (const line of lines) {
      const hit = dataFlowHit(line);
      if (hit !== undefined) dataFlow.push(`${safe(filename)}: added line uses \`${hit}\``);
    }
  }

  const problems = [];
  if (outside.length > 0) {
    problems.push(
      `Not a UI-tier PR, request architect review: these changed files are outside the UI-tier paths (ADR-0033 amendment 3): ` +
        `${[...new Set(outside)].join(", ")}. Remove the \`${UI_TIER_LABEL}\` label, or drop those files from the PR.`,
    );
  }
  if (dataFlow.length > 0) {
    problems.push(
      `Not a UI-tier PR, request architect review: this PR adds data-flow code under frontend/src (${[...new Set(dataFlow)].join("; ")}). ` +
        `Data fetching, storage and raw HTML need the architect. Remove the \`${UI_TIER_LABEL}\` label, or move that code to its own PR.`,
    );
  }
  if (unreadable.length > 0) {
    problems.push(
      `Cannot verify the UI tier: the diff of ${[...new Set(unreadable)].join(", ")} is too large for the API to include. ` +
        `Not a UI-tier PR, request architect review (or split the PR).`,
    );
  }
  return { ok: problems.length === 0, problems };
}

function main() {
  const readJson = (name, load) => {
    try {
      return JSON.parse(load());
    } catch {
      console.error(`::error::${name} is missing or not JSON; the UI-tier check cannot run.`);
      process.exit(1);
    }
  };
  const labels = readJson("PR_LABELS_JSON", () => process.env.PR_LABELS_JSON ?? "");
  // Without the label there is nothing to check: skip before reading the (possibly large) files list.
  if (!labels.includes(UI_TIER_LABEL)) {
    console.log(`UI-tier check skipped (no ${UI_TIER_LABEL} label).`);
    return;
  }
  const files = readJson("PR_FILES_FILE", () => readFileSync(process.env.PR_FILES_FILE ?? "", "utf8"));
  if (!Array.isArray(files)) {
    console.error("::error::PR_FILES_FILE is not a JSON array of files (an API error?); the UI-tier check cannot run.");
    process.exit(1);
  }
  const result = checkTier({ files, labels });
  if (!result.ok) {
    for (const problem of result.problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
  console.log("UI-tier check passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
