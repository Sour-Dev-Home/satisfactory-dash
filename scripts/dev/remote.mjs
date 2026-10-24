// SSH helpers for the optional remote dev box (remote-test.mjs, baselines.mjs --local). The box is OPTIONAL: the host
// comes only from the DEV_REMOTE_HOST environment variable (an ssh destination or alias), and with it unset every
// command behaves as it did before. Anything can fail, including the box, so each step reports whether it failed
// BEFORE the real work started (the caller then falls back) or during it (a real failure, never retried elsewhere).
//
// Nothing here builds a shell command from untrusted text: programs run with argument arrays, and the remote side
// receives one base64-encoded script whose interpolated values (sha, names, numbers) were validated and quoted.
// The pure parts (validation, quoting, argument parsing, the fallback decision, script building) are unit-tested in
// remote.test.mjs.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";

export const HOST_ENV = "DEV_REMOTE_HOST";
/** Printed by the remote script right before the tests start; seeing it means "the box got as far as the tests". */
export const TESTS_START = "@@TESTS-START@@";
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", "-o", "LogLevel=ERROR"];

// ---- pure helpers -------------------------------------------------------------------------------------------------

/** A path-safe name from a worktree directory name: only [A-Za-z0-9._-], no leading dot, at most 60 chars. */
export function sanitizeName(raw) {
  const s = String(raw ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 60);
  return s || "worktree";
}
export const isName = (s) => typeof s === "string" && /^[A-Za-z0-9._-]+$/.test(s) && !s.startsWith(".") && !s.startsWith("-");
export const isSha = (s) => typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
/** An ssh destination or alias: never starts with "-" (an option) and has no whitespace, quotes or shell characters. */
export const isHost = (s) => typeof s === "string" && /^[A-Za-z0-9._][A-Za-z0-9._@-]*$/.test(s);
/** A workspace directory like "backend" or "packages/shared". */
export const isWorkspace = (s) => typeof s === "string" && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(s) && !s.includes("..") && !s.startsWith("-");

/**
 * Text from the box made safe to print: every C0 control character except tab, newline and carriage return, DEL and the
 * C1 range are dropped one by one (no escape-sequence parsing, so a sequence split across chunks is neutralised too).
 */
export const stripControl = (s) => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");

/** Cap on what the box may send back through one ssh command (matches the archive cap in tarRead.mjs). */
export const MAX_CAPTURE_BYTES = 300 * 1024 * 1024;

/** POSIX single-quoting: safe for any string except it must not contain NUL. */
export function shq(s) {
  const str = String(s);
  if (str.includes("\0")) throw new Error("NUL in a shell argument");
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

/** The host from the environment, or null when the feature is off. */
export function hostFromEnv(env = process.env) {
  const h = (env[HOST_ENV] ?? "").trim();
  return h === "" ? null : h;
}

/** The ssh argument list that runs `script` (a bash script) on the host without any quoting layers. */
export function sshArgs(host, script) {
  if (!isHost(host)) throw new Error(`${HOST_ENV} is not a plain ssh destination`);
  const b64 = Buffer.from(script, "utf8").toString("base64");
  return [...SSH_OPTS, "--", host, `bash -c "$(printf %s ${b64} | base64 -d)"`];
}

/**
 * Where a run happens: the box, or here. `reachable` is only consulted (and only matters) when a host is set.
 * Returns { remote: true } or { remote: false, reason } (reason is null when local was asked for).
 */
export function decideTarget({ host, local = false, reachable = true }) {
  if (local) return { remote: false, reason: null };
  if (!host) return { remote: false, reason: `${HOST_ENV} is not set` };
  if (!isHost(host)) return { remote: false, reason: `${HOST_ENV} is not a plain ssh destination` };
  if (!reachable) return { remote: false, reason: "the remote box is unreachable over ssh" };
  return { remote: true };
}

/**
 * What to do when the box could not be used (or failed before the tests began): "fallback" to run here, or "fail".
 * A failure of the tests themselves never reaches this: it is a real result and is never retried.
 */
export function onPrefailure({ noFallback = false }) {
  return noFallback ? "fail" : "fallback";
}

/** Splits "the tests started?" from the exit code: a nonzero exit before the marker is a pre-test failure. */
export function classifyRun({ code, started }) {
  if (code === 0) return "passed";
  return started ? "tests-failed" : "prefailure";
}

/** Arguments of `npm run remote-test`. Throws a one-line Error for anything malformed. */
export function parseTestArgs(argv) {
  const out = { worktree: null, workspaces: [], db: false, files: [], workers: null, local: false, noFallback: false, untracked: false, clean: false, cleanName: null };
  const takesValue = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") out.db = true;
    else if (a === "--local") out.local = true;
    else if (a === "--no-fallback") out.noFallback = true;
    else if (a === "--untracked") out.untracked = true;
    else if (a === "--workspace" || a === "-w") out.workspaces.push(takesValue(i++, a));
    else if (a === "--workers") {
      const n = Number(takesValue(i++, a));
      if (!Number.isInteger(n) || n < 1 || n > 64) throw new Error("--workers must be an integer from 1 to 64");
      out.workers = n;
    } else if (a === "--files") {
      let n = 0;
      while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
        out.files.push(argv[++i]);
        n++;
      }
      if (n === 0) throw new Error("--files needs at least one glob or path");
    } else if (a === "--clean") {
      out.clean = true;
      if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) out.cleanName = argv[++i];
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else if (out.worktree === null) out.worktree = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  for (const w of out.workspaces) if (!isWorkspace(w)) throw new Error(`bad workspace name ${w}`);
  for (const f of out.files) if (f.startsWith("-") || f.includes("\0") || f.includes("\n")) throw new Error(`bad file filter ${f}`);
  if (out.cleanName !== null && !isName(out.cleanName)) throw new Error(`bad name ${out.cleanName}`);
  return out;
}

/** The workspaces to test: the ones asked for, else backend for --db, else every workspace that has tests. */
export const ALL_WORKSPACES = ["packages/shared", "packages/game-adapter", "frontend", "backend", "agent", "server-manager"];
export function workspacesFor({ workspaces, db }) {
  if (workspaces.length) return workspaces;
  return db ? ["backend"] : ALL_WORKSPACES;
}

/** The vitest arguments for one workspace (after `vitest`): same selection locally and remotely. */
export function vitestArgs({ db, files, workers }) {
  const filters = files.length ? files : db ? [".db.test.ts"] : [];
  return ["run", `--maxWorkers=${workers}`, ...filters];
}

/** Shared script head: lock, checkout of `sha` in `$ROOT/<dir>`, clean (keeping node_modules), `npm ci` when needed. */
function prepareScript({ dir, sha, install = true }) {
  if (!isName(dir) || !isSha(sha)) throw new Error("refusing to build a remote script from unvalidated values");
  return `set -eu
ROOT="$HOME/remote-test"; BARE="$HOME/remote-test.git"; D="$ROOT/"${shq(dir)}
mkdir -p "$ROOT"
exec 9>"$ROOT/"${shq(dir + ".lock")}
flock 9
git -C "$BARE" worktree prune
if ! git -C "$D" rev-parse --git-dir >/dev/null 2>&1; then
  rm -rf "$D"
  git -C "$BARE" worktree add -q -f --detach "$D" ${shq(sha)}
fi
cd "$D"
git checkout -q -f --detach ${shq(sha)}
git clean -fdxq -e node_modules
H=$(sha256sum package-lock.json | cut -d' ' -f1)
NEED_INSTALL=0
if [ ! -d node_modules ] || [ "$(cat node_modules/.remote-lockhash 2>/dev/null || true)" != "$H" ]; then NEED_INSTALL=1; fi
${install ? `if [ "$NEED_INSTALL" = 1 ]; then npm ci --no-audit --no-fund --loglevel=error; printf %s "$H" > node_modules/.remote-lockhash; fi` : ""}
`;
}

/** The remote script that checks out `sha` for `name` and runs vitest in each workspace; exit code = first failure. */
export function buildTestScript({ name, sha, workspaces, db, files, workers }) {
  if (!Number.isInteger(workers)) throw new Error("workers must be an integer");
  if (!workspaces.every(isWorkspace)) throw new Error("bad workspace");
  const run = vitestArgs({ db, files, workers }).map(shq).join(" ");
  // No colour: escape codes from the box are stripped before printing (stripControl), so they'd show as literal text.
  const env = `NO_COLOR=1 FORCE_COLOR=0 ${db ? "REQUIRE_DB=1 " : ""}`;
  const steps = workspaces
    .map((w) => `echo ${shq(`== ${w}`)}; ( cd ${shq(w)} && ${env}npx --no-install vitest ${run} ) || { r=$?; [ "$rc" -eq 0 ] && rc=$r; }`)
    .join("\n");
  return `${prepareScript({ dir: name, sha })}echo ${TESTS_START}
set +e
rc=0
${steps}
exit $rc
`;
}

/** Image reference (tag@digest) and Playwright version from the CI workflow's text, or null when it can't be read. */
export function parseCiImage(workflowText) {
  const m = /^\s*container:\s*(mcr\.microsoft\.com\/playwright:v([0-9.]+)-[a-z]+@sha256:[0-9a-f]{64})\s*$/m.exec(workflowText);
  return m ? { image: m[1], version: m[2] } : null;
}

/** The remote script that regenerates baselines in CI's container image. Same env and commands as e2e.yml. */
export function buildBaselinesScript({ name, sha, image, version }) {
  if (!/^[a-z0-9./_:-]+@sha256:[0-9a-f]{64}$/.test(image) || !/^[0-9.]+$/.test(version)) throw new Error("bad image reference");
  const dir = `${name}.pw`;
  const inner = `set -eu
locked=$(node -p "require('./package-lock.json').packages['node_modules/@playwright/test'].version")
if [ "$locked" != "$PLAYWRIGHT_VERSION" ]; then echo "package-lock.json has @playwright/test $locked but the CI image is $PLAYWRIGHT_VERSION"; exit 1; fi
if [ "$NEED_INSTALL" = 1 ]; then npm ci --no-audit --no-fund --loglevel=error; printf %s "$LOCK_HASH" > node_modules/.remote-lockhash; fi
echo ${TESTS_START}
exec npm run e2e -w frontend -- --update-snapshots=changed
`;
  // npm ci runs in the container (CI's Node), so the host's Node never touches this checkout's node_modules.
  return `${prepareScript({ dir, sha, install: false })}docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI=true -e PLAYWRIGHT_SNAPSHOTS=1 -e PLAYWRIGHT_VERSION=${shq(version)} -e NEED_INSTALL="$NEED_INSTALL" -e LOCK_HASH="$H" -v "$D:/work" -w /work ${shq(image)} sh -c ${shq(inner)}
`;
}

/** Remote script that prints the regenerated screenshots folder as a tar stream on stdout. */
export function buildFetchScript({ name, folder }) {
  if (!isName(name) || !isWorkspace(folder)) throw new Error("bad name or folder");
  return `set -eu\ncd "$HOME/remote-test/"${shq(`${name}.pw`)}/${shq(folder)}\nfind . -type f -name '*.png' -print0 | tar --null --format=ustar -T - -cf -\n`;
}

/** Remote script for `--clean`: one checkout (all its variants) and its ref, or everything. */
export function buildCleanScript(name) {
  if (name === null || name === undefined) return `set -u\nrm -rf "$HOME/remote-test" "$HOME/remote-test.git"\necho "removed all remote checkouts"\n`;
  if (!isName(name)) throw new Error("bad name");
  const variants = [name, `${name}.pw`].map((n) => `"$HOME/remote-test/"${shq(n)}`).join(" ");
  return `set -u
for d in ${variants}; do git -C "$HOME/remote-test.git" worktree remove --force "$d" 2>/dev/null || rm -rf "$d"; done
rm -f "$HOME/remote-test/"${shq(name + ".lock")} "$HOME/remote-test/"${shq(name + ".pw.lock")}
git -C "$HOME/remote-test.git" worktree prune 2>/dev/null || true
git -C "$HOME/remote-test.git" update-ref -d ${shq(`refs/remote-test/${name}`)} 2>/dev/null || true
echo ${shq(`removed remote checkout ${name}`)}
`;
}

export const bareInitScript = () => `set -eu\ngit init --bare -q "$HOME/remote-test.git"\n`;

// ---- effects ------------------------------------------------------------------------------------------------------

/** True when `ssh <host> true` succeeds within the connect timeout. */
export function reachable(host) {
  if (!isHost(host)) return false;
  try {
    const r = spawnSync("ssh", [...SSH_OPTS, "--", host, "true"], { stdio: "ignore", timeout: 15_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** Runs `script` on the host. Streams stdout/stderr (minus the marker) unless `quiet`; keeps the last lines for summaries. */
export function sshRun(host, script, { quiet = false } = {}) {
  return new Promise((resolve) => {
    let started = false;
    const tail = [];
    const child = spawn("ssh", sshArgs(host, script), { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const line = (raw) => {
      const l = stripControl(raw);
      if (l.trim() === TESTS_START) {
        started = true;
        return;
      }
      tail.push(l);
      if (tail.length > 80) tail.shift();
      if (!quiet) process.stdout.write(`${l}\n`);
    };
    child.stdout.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        line(buf.slice(0, i).replace(/\r$/, ""));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on("data", (d) => {
      const s = stripControl(d.toString("utf8"));
      for (const l of s.split("\n").filter(Boolean)) tail.push(l);
      if (!quiet) process.stderr.write(s);
    });
    child.on("error", (e) => resolve({ code: 255, started, tail: [...tail, String(e.message)] }));
    child.on("close", (code) => {
      if (buf) line(buf);
      resolve({ code: code ?? 255, started, tail });
    });
  });
}

/** Runs `script` on the host and returns its stdout as a Buffer (for tar streams). Rejects on a nonzero exit. */
export function sshCapture(host, script, max = MAX_CAPTURE_BYTES) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", sshArgs(host, script), { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let err = "";
    let size = 0;
    let tooBig = false;
    child.stdout.on("data", (d) => {
      if (tooBig) return;
      size += d.length;
      if (size > max) {
        tooBig = true;
        chunks.length = 0;
        child.kill();
        return;
      }
      chunks.push(d);
    });
    child.stderr.on("data", (d) => {
      if (err.length < 8192) err += stripControl(d.toString("utf8"));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (tooBig) reject(new Error(`the box sent more than ${max} bytes`));
      else if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ssh exited ${code}: ${err.trim().split("\n").pop()}`));
    });
  });
}

function git(worktree, args, opts = {}) {
  const r = spawnSync("git", ["-C", worktree, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}`);
  return (r.stdout ?? "").trim();
}

/**
 * The commit that holds the worktree's exact state, without touching its branches, index or stash list.
 * Default: `git stash create` (HEAD plus uncommitted TRACKED changes; empty output means a clean tree, so HEAD).
 * `untracked`: also new, non-ignored files, built in a throwaway index file so the real index is never written.
 * Returns { sha, untracked: [paths not included] }.
 */
export function createStateCommit(worktree, { untracked = false } = {}) {
  const head = git(worktree, ["rev-parse", "HEAD"]);
  const extra = git(worktree, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  if (untracked) {
    const tmpIndex = `${git(worktree, ["rev-parse", "--absolute-git-dir"])}/remote-test-index-${process.pid}`;
    try {
      const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
      // Start from HEAD so tracked files that match .gitignore stay in; `add -A` then adds only non-ignored new files.
      git(worktree, ["read-tree", "HEAD"], { env });
      git(worktree, ["add", "-A"], { env });
      const tree = git(worktree, ["write-tree"], { env });
      const sha = git(worktree, ["commit-tree", tree, "-p", head, "-m", "remote-test state"], { env });
      return { sha, untracked: [] };
    } finally {
      rmSync(tmpIndex, { force: true });
    }
  }
  const stash = git(worktree, ["stash", "create"]);
  return { sha: isSha(stash) ? stash : head, untracked: extra };
}

/** A failure before the real work started on the box: the caller may fall back. */
export class PreTestError extends Error {}

/**
 * Ships the worktree's state to the box: reachability check, bare repo, push to refs/remote-test/<name>.
 * Throws PreTestError with a one-line reason on any failure; returns { sha, untracked } on success.
 */
export async function shipState({ host, worktree, name, untracked = false }) {
  if (!isName(name)) throw new PreTestError("internal: bad checkout name");
  if (!reachable(host)) throw new PreTestError("the remote box is unreachable over ssh");
  let state;
  try {
    state = createStateCommit(worktree, { untracked });
  } catch (e) {
    throw new PreTestError(`could not snapshot the worktree: ${e.message}`);
  }
  if (!isSha(state.sha)) throw new PreTestError("internal: snapshot is not a commit id");
  const init = await sshRun(host, bareInitScript(), { quiet: true });
  if (init.code !== 0) throw new PreTestError(`could not create the bare repo on the box (${init.tail.at(-1) ?? `exit ${init.code}`})`);
  const push = spawnSync("git", ["-C", worktree, "push", "-q", "--force", `${host}:remote-test.git`, `${state.sha}:refs/remote-test/${name}`], {
    encoding: "utf8",
    env: { ...process.env, GIT_SSH_COMMAND: `ssh ${SSH_OPTS.join(" ")}` },
    timeout: 300_000,
  });
  if (push.status !== 0) throw new PreTestError(`git push to the box failed (${(push.stderr || String(push.error ?? "")).trim().split("\n").pop()})`);
  return state;
}

export const fingerprint = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
