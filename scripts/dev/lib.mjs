// Shared, pure helpers for the dev scripts in this folder (baselines, ship-pr, cleanup-merged). Everything that
// touches git, gh or the filesystem lives in the scripts; this file only decides, so it's unit-tested
// (lib.test.mjs). The scripts work in this repo and in the portfolio repo: REPOS says how each one keeps its
// visual baselines and whether its PRs auto-merge.
import { spawnSync } from "node:child_process";

export const REPOS = {
  "Sour-Dev-Home/satisfactory-dash": {
    workflow: "e2e.yml",
    fields: { update_snapshots: "true" },
    artifact: "playwright-baselines",
    screenshots: "frontend/e2e/__screenshots__",
    autoMerge: true, // ADR-0043: PRs squash auto-merge on the required checks
    needsNodeModules: true, // the pre-push preflight hook runs node scripts
  },
  "Sour-Dev-Home/leonardo-nunez-portfolio": {
    workflow: "update-screenshots.yml",
    fields: {},
    artifact: "screenshots",
    screenshots: "e2e/__screenshots__",
    autoMerge: false, // main deploys live: the owner merges after reviewing the preview
    needsNodeModules: false,
  },
};

/** "owner/name" from a git remote URL (https or ssh), or null. */
export function repoFromRemote(url) {
  const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(String(url).trim());
  return m ? m[1] : null;
}

/** A simple glob ("*" within a path segment, "**" across segments) or a plain substring, as a RegExp. */
export function globToRegExp(glob) {
  if (!/[*?]/.test(glob)) return new RegExp(glob.replace(/[.+^${}()|[\]\\]/g, "\\$&"));
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** The relative paths to apply: all of them, or those matching any of `only`. Paths use "/". */
export function selectFiles(paths, only = []) {
  if (only.length === 0) return paths;
  const res = only.map(globToRegExp);
  return paths.filter((p) => res.some((re) => re.test(p)));
}

/** The newest workflow_dispatch run on `branch` created at or after `since` (ms), from `gh run list` JSON. */
export function pickDispatchedRun(runs, since) {
  return (
    runs
      .filter((r) => Date.parse(r.createdAt) >= since - 10_000)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null
  );
}

// What must never be committed to these public repos (root CLAUDE.md: no absolute local paths; the portfolio
// rule on that phrase). Personal identifiers stay in the CI security job's secret PII_PATTERNS, not here.
const FORBIDDEN = [
  { re: /\b[A-Za-z]:\\+Users\\+/, why: "an absolute Windows user path" },
  { re: /\/c\/Users\//i, why: "an absolute Git Bash user path" },
  { re: /(?:^|[\s"'`(])\/(?:Users|home)\/[A-Za-z]/, why: "an absolute macOS or Linux home path" },
  // Assembled from pieces, so this file passes the scan it defines.
  { re: new RegExp(["hiring", "manager"].join(" "), "i"), why: `the phrase "${["hiring", "manager"].join(" ")}"` },
];

/** Problems in a unified diff's ADDED lines: [{ file, line, why }]. Removed and context lines are ignored. */
export function scanDiff(diff) {
  const problems = [];
  let file = null;
  let line = 0;
  for (const raw of String(diff).split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.slice(4).replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+")) {
      for (const f of FORBIDDEN) if (f.re.test(raw)) problems.push({ file, line, why: f.why });
      line++;
    } else if (!raw.startsWith("-")) line++;
  }
  return problems;
}

/** Porcelain `git status` lines that block shipping or cleanup: anything but untracked agent report files. */
export function blockingStatus(porcelain) {
  return String(porcelain)
    .split("\n")
    .filter((l) => l.trim() !== "")
    .filter((l) => !/^\?\? \.claude-impl-[\w-]+\.md$/.test(l));
}

/** `git worktree list --porcelain` as [{ path, branch, locked }]. */
export function parseWorktrees(porcelain) {
  const out = [];
  let cur = null;
  for (const l of String(porcelain).split("\n")) {
    if (l.startsWith("worktree ")) {
      cur = { path: l.slice(9).trim(), branch: null, locked: false };
      out.push(cur);
    } else if (cur && l.startsWith("branch ")) cur.branch = l.slice(7).trim().replace(/^refs\/heads\//, "");
    else if (cur && (l === "locked" || l.startsWith("locked "))) cur.locked = true;
  }
  return out;
}

/** Runs a program with an argument array (never a shell). Throws with its stderr when it fails, unless `ok`. */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw r.error;
  const out = (r.stdout ?? "").trim(); // null when stdout is ignored
  if (r.status !== 0 && !opts.ok) throw new Error(`${cmd} ${args[0] ?? ""} failed (${r.status}): ${(r.stderr || out).trim()}`);
  return out;
}

export function repoOf(dir) {
  const repo = repoFromRemote(run("git", ["-C", dir, "remote", "get-url", "origin"]));
  if (!repo || !REPOS[repo]) throw new Error(`not a known repo (${repo ?? "no origin"}); known: ${Object.keys(REPOS).join(", ")}`);
  return repo;
}

/** --name value pairs and bare --flags into an object; positionals into `_`. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) out._.push(a);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) out[a.slice(2)] = true;
    else {
      const key = a.slice(2);
      const v = argv[++i];
      out[key] = key === "only" ? [...(out.only ?? []), v] : v;
    }
  }
  return out;
}
