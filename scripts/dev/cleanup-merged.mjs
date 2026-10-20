#!/usr/bin/env node
// Remove the worktrees and local branches of merged PRs under <repo>/.claude/worktrees/.
//
//   node scripts/dev/cleanup-merged.mjs [<repo-root>] [--dry-run]
//
// It skips locked worktrees (a running agent holds those), worktrees with uncommitted work (other than an agent's
// untracked .claude-impl-*.md report) and any branch whose PR isn't merged. It never touches the main checkout.
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { blockingStatus, parseArgs, parseWorktrees, repoOf, run } from "./lib.mjs";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args._[0] ?? ".");
  const repo = repoOf(root);
  const inWorktrees = (p) => resolve(p).toLowerCase().startsWith(resolve(root, ".claude", "worktrees").toLowerCase() + sep);
  const trees = parseWorktrees(run("git", ["-C", root, "worktree", "list", "--porcelain"])).filter((t) => inWorktrees(t.path));
  let removed = 0;
  for (const t of trees) {
    const label = `${t.branch ?? "(detached)"} at ${t.path}`;
    if (t.locked) {
      console.log(`skip (locked, an agent may be running): ${label}`);
      continue;
    }
    if (!t.branch) {
      console.log(`skip (detached): ${label}`);
      continue;
    }
    const merged = run("gh", ["pr", "list", "-R", repo, "--head", t.branch, "--state", "merged", "--json", "number", "--jq", "length"]);
    if (merged === "0") {
      console.log(`keep (no merged PR): ${label}`);
      continue;
    }
    const dirty = blockingStatus(run("git", ["-C", t.path, "status", "--porcelain"]));
    if (dirty.length) {
      console.log(`skip (uncommitted work): ${label}`);
      continue;
    }
    if (args["dry-run"]) {
      console.log(`would remove: ${label}`);
      continue;
    }
    run("git", ["-C", root, "worktree", "remove", "--force", t.path]);
    run("git", ["-C", root, "branch", "-D", t.branch], { ok: true });
    console.log(`removed: ${label}`);
    removed++;
  }
  console.log(`${removed} removed, ${trees.length - removed} left`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
