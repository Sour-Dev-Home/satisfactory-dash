#!/usr/bin/env node
// Regenerate a branch's visual baselines in CI's container and apply them to its worktree, in one command.
// Visual baselines only ever come from CI (fonts differ per OS), so this replaces the by-hand routine: dispatch the
// screenshot workflow, wait, download the artifact, copy it in, see what changed.
//
//   node scripts/dev/baselines.mjs <worktree> [--only <glob>]... [--run <id>] [--commit "<message>"]
//
//   --only    apply just the matching files (relative to the screenshots folder, e.g. "desktop/map.png" or
//             "**/case-study*"); everything else from the artifact is ignored. Repeatable.
//   --run     use a run that's already done or running instead of dispatching a new one.
//   --commit  commit the applied files (it never pushes).
//
// It works for satisfactory-dash and the portfolio (lib.mjs REPOS). It refuses a worktree on main.
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { configFor, parseArgs, pickDispatchedRun, repoOf, run, selectFiles } from "./lib.mjs";

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

async function dispatch(repo, cfg, branch) {
  const since = Date.now();
  const fields = Object.entries(cfg.fields).flatMap(([k, v]) => ["-f", `${k}=${v}`]);
  run("gh", ["workflow", "run", cfg.workflow, "-R", repo, "--ref", branch, ...fields]);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const runs = JSON.parse(
      run("gh", ["run", "list", "-R", repo, "--workflow", cfg.workflow, "--branch", branch, "--event", "workflow_dispatch",
        "--limit", "5", "--json", "databaseId,createdAt"]),
    );
    const picked = pickDispatchedRun(runs, since);
    if (picked) return String(picked.databaseId);
  }
  throw new Error("the dispatched run didn't appear within 2 minutes");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const worktree = resolve(args._[0] ?? ".");
  const repo = repoOf(worktree);
  const cfg = configFor(repo);
  const branch = run("git", ["-C", worktree, "branch", "--show-current"]);
  if (!branch || branch === "main") throw new Error("run this on a feature branch's worktree, never main");
  if (run("git", ["-C", worktree, "rev-parse", "HEAD"]) !== run("git", ["-C", worktree, "rev-parse", `origin/${branch}`], { ok: true })) {
    throw new Error(`push ${branch} first: CI screenshots the pushed commit, not your local one`);
  }

  const id = args.run ? String(args.run) : await dispatch(repo, cfg, branch);
  console.log(`run ${id}: https://github.com/${repo}/actions/runs/${id}`);
  run("gh", ["run", "watch", id, "-R", repo, "--exit-status", "--interval", "30"], { ok: true, stdio: ["ignore", "ignore", "pipe"] });
  const conclusion = run("gh", ["run", "view", id, "-R", repo, "--json", "conclusion", "--jq", ".conclusion"]);
  if (conclusion !== "success") {
    throw new Error(`run ${id} ended ${conclusion || "unknown"}: a test failed before the baselines were saved; fix it first (gh run view ${id} -R ${repo} --log-failed)`);
  }

  const tmp = mkdtempSync(join(tmpdir(), "baselines-"));
  try {
    run("gh", ["run", "download", id, "-R", repo, "-n", cfg.artifact, "-D", tmp]);
    const all = filesUnder(tmp).map((f) => relative(tmp, f).split(sep).join("/"));
    const chosen = selectFiles(all, args.only ?? []);
    const dest = join(worktree, cfg.screenshots);
    if (!existsSync(dest)) throw new Error(`no ${cfg.screenshots} in ${worktree}`);
    for (const rel of chosen) cpSync(join(tmp, rel), join(dest, rel));
    const changed = run("git", ["-C", worktree, "status", "--porcelain", "--", cfg.screenshots]).split("\n").filter(Boolean);
    console.log(`applied ${chosen.length} of ${all.length} files; ${changed.length} changed:`);
    for (const l of changed) console.log(`  ${l}`);
    if (changed.length && args.commit) {
      run("git", ["-C", worktree, "add", "--", cfg.screenshots]);
      run("git", ["-C", worktree, "-c", "core.safecrlf=false", "commit", "-q", "-m", String(args.commit), "-m", `From ${cfg.workflow} run ${id}.`]);
      console.log(`committed: ${run("git", ["-C", worktree, "log", "--oneline", "-1"])} (not pushed)`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
