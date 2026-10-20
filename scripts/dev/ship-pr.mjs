#!/usr/bin/env node
// Ship a finished branch as a PR: refuse uncommitted work, scan the diff for absolute local paths (and the
// portfolio's banned phrase), push, open the PR from a body file, and turn on squash auto-merge where the repo
// allows it (satisfactory-dash, ADR-0043; never the portfolio, whose main deploys live).
//
//   node scripts/dev/ship-pr.mjs <worktree> --title "<title>" --body-file <path> [--no-auto]
//
// It never pushes main, never force-pushes and never merges by hand.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { blockingStatus, configFor, parseArgs, repoOf, run, scanDiff } from "./lib.mjs";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const worktree = resolve(args._[0] ?? ".");
  if (!args.title || !args["body-file"]) throw new Error('usage: ship-pr.mjs <worktree> --title "<title>" --body-file <path> [--no-auto]');
  if (!existsSync(args["body-file"])) throw new Error(`no body file at ${args["body-file"]}`);
  const repo = repoOf(worktree);
  const cfg = configFor(repo);
  const branch = run("git", ["-C", worktree, "branch", "--show-current"]);
  if (!branch || branch === "main") throw new Error("ship a feature branch, never main");

  const dirty = blockingStatus(run("git", ["-C", worktree, "status", "--porcelain"]));
  if (dirty.length) throw new Error(`commit or remove these first:\n  ${dirty.join("\n  ")}`);

  run("git", ["-C", worktree, "fetch", "-q", "origin", "main"]);
  const problems = scanDiff(run("git", ["-C", worktree, "diff", "origin/main...HEAD"]));
  if (problems.length) {
    throw new Error(`the diff adds what must never be committed:\n  ${problems.map((p) => `${p.file}:${p.line} ${p.why}`).join("\n  ")}`);
  }

  if (cfg.needsNodeModules && !existsSync(join(worktree, "node_modules"))) {
    console.log("installing dependencies for the pre-push check...");
    // npm is a .cmd on Windows, which Node only spawns through a shell; the arguments are fixed.
    run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: worktree, shell: true, stdio: ["ignore", "ignore", "pipe"] });
  }
  run("git", ["-C", worktree, "-c", "core.safecrlf=false", "push", "-u", "origin", branch], { stdio: ["ignore", "ignore", "pipe"] });

  const existing = run("gh", ["pr", "list", "-R", repo, "--head", branch, "--state", "open", "--json", "url", "--jq", ".[0].url // empty"]);
  const url = existing || run("gh", ["pr", "create", "-R", repo, "--base", "main", "--head", branch, "--title", String(args.title), "--body-file", String(args["body-file"])]);
  console.log(existing ? `pushed; PR already open: ${url}` : `opened ${url}`);

  if (cfg.autoMerge && !args["no-auto"]) {
    run("gh", ["pr", "merge", url, "--squash", "--auto"]);
    console.log("squash auto-merge on: it merges itself once the required checks pass");
  } else {
    console.log(cfg.autoMerge ? "auto-merge left off (--no-auto)" : "no auto-merge in this repo: the owner merges");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
