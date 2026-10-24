#!/usr/bin/env node
// Regenerate a branch's visual baselines in CI's container and apply them to its worktree, in one command.
// Visual baselines only ever come from CI (fonts differ per OS), so this replaces the by-hand routine: dispatch the
// screenshot workflow, wait, download the artifact, copy it in, see what changed.
//
//   node scripts/dev/baselines.mjs <worktree> [--only <glob>]... [--run <id>] [--commit "<message>"] [--local]
//
//   --only    apply just the matching files (relative to the screenshots folder, e.g. "desktop/map.png" or
//             "**/case-study*"); everything else from the artifact is ignored. Repeatable.
//   --run     use a run that's already done or running instead of dispatching a new one.
//   --commit  commit the applied files (it never pushes).
//   --local   regenerate on the optional remote box (DEV_REMOTE_HOST) in the same container image CI uses, instead of
//             dispatching CI: no push needed. If the box is unset, unreachable or fails before the tests run, it says
//             why and continues with the CI path above. --untracked also ships new files.
//
// It works for satisfactory-dash and the portfolio (lib.mjs REPOS). It refuses a worktree on main.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { configFor, parseArgs, pickDispatchedRun, repoOf, run, selectFiles } from "./lib.mjs";
import {
  buildBaselinesScript, buildFetchScript, classifyRun, hostFromEnv, HOST_ENV, isHost, parseCiImage, PreTestError, sanitizeName, shipState, sshCapture, sshRun,
} from "./remote.mjs";
import { extractPngTar } from "./tarRead.mjs";

/** Regular .png files under `dir`; symlinks and every other kind of entry are skipped (never followed). */
function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) out.push(...filesUnder(p));
    else if (st.isFile() && name.toLowerCase().endsWith(".png")) out.push(p);
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

/** Copies the chosen files from `tmp` (the artifact's layout) into the worktree and reports/commits like CI's path. */
function applyBaselines({ tmp, worktree, cfg, args, source }) {
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
    run("git", ["-C", worktree, "-c", "core.safecrlf=false", "commit", "-q", "-m", String(args.commit), "-m", `From ${source}.`]);
    console.log(`committed: ${run("git", ["-C", worktree, "log", "--oneline", "-1"])} (not pushed)`);
  }
}

/**
 * --local: regenerate on the optional remote box in CI's own container image (read from e2e.yml, so it can't drift),
 * with the same env and command. Returns true when the baselines were applied; false when the box couldn't be used
 * BEFORE the tests ran (the caller then falls back to CI). Throws when a test failed in the container.
 */
async function viaBox({ args, worktree, cfg, repo }) {
  const started = Date.now();
  const fail = (why) => {
    console.log(`${why}: falling back to the CI path`);
    return false;
  };
  if (repo !== "Sour-Dev-Home/satisfactory-dash") return fail("--local is only built for satisfactory-dash");
  const host = hostFromEnv();
  if (!host) return fail(`${HOST_ENV} is not set`);
  if (!isHost(host)) return fail(`${HOST_ENV} is not a plain ssh destination`);
  const ci = parseCiImage(readFileSync(join(worktree, ".github/workflows/e2e.yml"), "utf8"));
  if (!ci) return fail("could not read the pinned image from e2e.yml");
  const name = sanitizeName(basename(worktree));
  let state;
  try {
    state = await shipState({ host, worktree, name, untracked: Boolean(args.untracked) });
  } catch (e) {
    if (e instanceof PreTestError) return fail(e.message);
    throw e;
  }
  console.log(`shipped ${state.sha.slice(0, 10)}; regenerating in ${ci.image.split("@")[0]} on the box (the first run pulls the image and installs)`);
  const r = await sshRun(host, buildBaselinesScript({ name, sha: state.sha, ...ci }), { quiet: true });
  const kind = classifyRun(r);
  if (kind === "prefailure") return fail(`the box failed before the tests started (exit ${r.code}: ${r.tail.at(-1) ?? "no output"})`);
  if (kind === "tests-failed") {
    throw new Error(`the local container run ended with exit ${r.code}: a test failed before the baselines were saved; fix it first. Last output:\n${r.tail.slice(-40).join("\n")}`);
  }
  const tmp = mkdtempSync(join(tmpdir(), "baselines-"));
  try {
    try {
      const tarball = await sshCapture(host, buildFetchScript({ name, folder: cfg.screenshots }));
      const dir = join(tmp, "shots");
      mkdirSync(dir);
      // The box is less trusted than this PC: parse the archive ourselves (regular .png files only, whole archive
      // rejected on anything else) instead of handing it to the system tar, which turns symlinks into file copies.
      extractPngTar(tarball, dir);
      applyBaselines({ tmp: dir, worktree, cfg, args, source: `a local run in CI's container image (${ci.version})` });
    } catch (e) {
      return fail(`could not copy the baselines back (${e.message})`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const worktree = resolve(args._[0] ?? ".");
  const repo = repoOf(worktree);
  const cfg = configFor(repo);
  const branch = run("git", ["-C", worktree, "branch", "--show-current"]);
  if (!branch || branch === "main") throw new Error("run this on a feature branch's worktree, never main");
  if (args.local && (await viaBox({ args, worktree, cfg, repo }))) return;
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
    applyBaselines({ tmp, worktree, cfg, args, source: `${cfg.workflow} run ${id}` });
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
