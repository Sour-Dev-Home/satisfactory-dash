#!/usr/bin/env node
// Run a worktree's vitest suites on the optional remote dev box (DEV_REMOTE_HOST), falling back to this machine.
//
//   node scripts/dev/remote-test.mjs <worktree> [--workspace <ws>]... [--db] [--files <globs...>] [--workers N]
//                                    [--local] [--no-fallback] [--untracked]
//   node scripts/dev/remote-test.mjs --clean [<name>]
//
//   --workspace   workspace directory to test (repeatable); default: backend with --db, else every workspace.
//   --db          run the database tests (REQUIRE_DB=1, like `npm run test:db -w backend`); Docker is the box's own.
//   --files       vitest file filters, relative to each workspace.
//   --workers     remote --maxWorkers (default 6); a local fallback always uses 2.
//   --local       skip the box and run here.
//   --no-fallback exit non-zero instead of running here when the box can't be used.
//   --untracked   also ship new, non-ignored files (default: warn that they are not included).
//   --clean       delete the remote checkout of <name>, or all of them.
//
// The worktree's exact state travels as a commit made with `git stash create` (no branch, index or stash list is
// touched), pushed to a bare repo on the box under refs/remote-test/<name>. Only a failure BEFORE the tests start
// (no host, unreachable, push, checkout, npm ci) falls back to running here; a failing test is a real failure.
import { spawn, spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { npmInvocation } from "./lib.mjs";
import {
  buildCleanScript, buildTestScript, classifyRun, decideTarget, hostFromEnv, isHost, onPrefailure, parseTestArgs, PreTestError,
  reachable, sanitizeName, shipState, sshRun, vitestArgs, workspacesFor,
} from "./remote.mjs";

const REMOTE_WORKERS = 6;
const LOCAL_WORKERS = 2;

function dockerAnswers() {
  try {
    return spawnSync("docker", ["info"], { stdio: "ignore", timeout: 8000 }).status === 0;
  } catch {
    return false;
  }
}

function spawnInherit(cmd, args, opts) {
  return new Promise((res) => {
    const c = spawn(cmd, args, { stdio: "inherit", ...opts });
    c.on("error", () => res(127));
    c.on("close", (code) => res(code ?? 1));
  });
}

/** The same selection as the box, here: never more than 2 workers; db tests only when local Docker answers. */
async function runLocal(args, worktree) {
  if (args.db && !dockerAnswers()) {
    console.log("local Docker did not answer: skipping the db tests (nothing was run)");
    return 0;
  }
  const npm = npmInvocation();
  let rc = 0;
  for (const ws of workspacesFor(args)) {
    console.log(`== ${ws}`);
    const env = { ...process.env, ...(args.db ? { REQUIRE_DB: "1" } : {}) };
    const code = await spawnInherit(npm.cmd, [...npm.args, "exec", "-w", ws, "--", "vitest", ...vitestArgs({ ...args, workers: LOCAL_WORKERS })], { cwd: worktree, env });
    if (code !== 0 && rc === 0) rc = code;
  }
  return rc;
}

/** Returns { status: "done", code } or { status: "prefailure", reason }. */
async function runRemote(args, worktree, name, host) {
  let state;
  try {
    state = await shipState({ host, worktree, name, untracked: args.untracked });
  } catch (e) {
    if (e instanceof PreTestError) return { status: "prefailure", reason: e.message };
    throw e;
  }
  if (state.untracked.length) {
    console.log(`note: ${state.untracked.length} untracked file(s) are NOT on the box (add them or pass --untracked): ${state.untracked.slice(0, 5).join(", ")}${state.untracked.length > 5 ? ", ..." : ""}`);
  }
  console.log(`shipped ${state.sha.slice(0, 10)} as ${name}; running on the box`);
  const script = buildTestScript({ name, sha: state.sha, workspaces: workspacesFor(args), db: args.db, files: args.files, workers: args.workers ?? REMOTE_WORKERS });
  const r = await sshRun(host, script);
  const kind = classifyRun(r);
  if (kind === "prefailure") return { status: "prefailure", reason: `the box failed before the tests started (exit ${r.code}: ${r.tail.at(-1) ?? "no output"})` };
  return { status: "done", code: r.code };
}

async function clean(args, host) {
  if (!host || !isHost(host)) throw new Error("DEV_REMOTE_HOST is not set (or is not a plain ssh destination): nothing to clean");
  if (!reachable(host)) throw new Error("the remote box is unreachable over ssh: nothing was cleaned");
  const r = await sshRun(host, buildCleanScript(args.cleanName === null ? null : sanitizeName(args.cleanName)));
  return r.code;
}

async function main() {
  const args = parseTestArgs(process.argv.slice(2));
  const host = hostFromEnv();
  if (args.clean) process.exit(await clean(args, host));

  const worktree = resolve(args.worktree ?? ".");
  const top = spawnSync("git", ["-C", worktree, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0) throw new Error(`${worktree} is not a git worktree`);
  const name = sanitizeName(basename(resolve(top.stdout.trim())));

  let reason = null;
  const target = decideTarget({ host, local: args.local, reachable: host && isHost(host) && !args.local ? reachable(host) : true });
  if (target.remote) {
    const res = await runRemote(args, worktree, name, host);
    if (res.status === "done") process.exit(res.code);
    reason = res.reason;
  } else reason = target.reason;

  if (reason !== null) {
    if (onPrefailure(args) === "fail") {
      console.error(`${reason}; --no-fallback given, not running locally`);
      process.exit(1);
    }
    console.log(`${reason}: running the tests locally (--maxWorkers=${LOCAL_WORKERS})`);
  }
  process.exit(await runLocal(args, worktree));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
