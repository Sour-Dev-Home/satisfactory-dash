import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBaselinesScript, buildCleanScript, buildFetchScript, buildTestScript, classifyRun, decideTarget, isHost, isName, isSha, onPrefailure,
  isWorkspace, parseCiImage, parseTestArgs, sanitizeName, shq, sshArgs, stripControl, TESTS_START, vitestArgs, workspacesFor, createStateCommit,
} from "./remote.mjs";
import { extractPngTar, MAX_FILE_BYTES } from "./tarRead.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SHA = "a".repeat(40);
const DIGEST = "b".repeat(64);

test("sanitizeName keeps only path-safe characters", () => {
  assert.equal(sanitizeName("my worktree/../x"), "my-worktree-..-x");
  assert.equal(sanitizeName("..hidden"), "hidden");
  assert.equal(sanitizeName("-rf"), "rf");
  assert.equal(sanitizeName("///"), "worktree");
  assert.equal(sanitizeName("a".repeat(100)).length, 60);
  assert.ok(isName(sanitizeName("Ünï cödé; rm -rf ~")));
});

test("validators: names, shas and hosts", () => {
  assert.ok(isName("feat-x_1.2"));
  assert.ok(!isName("a b") && !isName("a/b") && !isName("-x") && !isName(".x") && !isName(""));
  assert.ok(isSha(SHA));
  assert.ok(!isSha("A".repeat(40)) && !isSha("abc") && !isSha(`${SHA}; id`));
  assert.ok(isHost("devbox") && isHost("user@10.0.0.2") && isHost("my-alias.example"));
  assert.ok(!isHost("-oProxyCommand=x") && !isHost("a b") && !isHost("a;b") && !isHost("") && !isHost("$(id)"));
});

test("shq quotes a hostile string into one literal word", () => {
  assert.equal(shq("plain"), "'plain'");
  assert.equal(shq("it's"), `'it'\\''s'`);
  assert.equal(shq("$(rm -rf ~); `x`"), "'$(rm -rf ~); `x`'");
  assert.throws(() => shq("a\0b"));
});

test("parseTestArgs reads the documented flags", () => {
  const a = parseTestArgs(["wt", "--workspace", "backend", "--db", "--files", "a.test.ts", "src/**/b.test.ts", "--workers", "4", "--no-fallback"]);
  assert.deepEqual(a.workspaces, ["backend"]);
  assert.equal(a.worktree, "wt");
  assert.equal(a.db, true);
  assert.deepEqual(a.files, ["a.test.ts", "src/**/b.test.ts"]);
  assert.equal(a.workers, 4);
  assert.equal(a.noFallback, true);
  assert.equal(a.local, false);
});

test("parseTestArgs: --clean takes an optional name; bad input throws one line", () => {
  assert.deepEqual([parseTestArgs(["--clean"]).clean, parseTestArgs(["--clean"]).cleanName], [true, null]);
  assert.equal(parseTestArgs(["--clean", "feat-x"]).cleanName, "feat-x");
  assert.throws(() => parseTestArgs(["--clean", "a b"]), /bad name/);
  assert.throws(() => parseTestArgs(["--workers", "0"]), /--workers/);
  assert.throws(() => parseTestArgs(["--workers"]), /needs a value/);
  assert.throws(() => parseTestArgs(["--files"]), /at least one/);
  assert.throws(() => parseTestArgs(["--files", "-x"]), /bad file filter/);
  assert.throws(() => parseTestArgs(["--workspace", "../x"]), /bad workspace/);
  assert.throws(() => parseTestArgs(["--nope"]), /unknown option/);
  assert.throws(() => parseTestArgs(["a", "b"]), /unexpected argument/);
});

test("workspacesFor defaults to backend for --db and every workspace otherwise", () => {
  assert.deepEqual(workspacesFor({ workspaces: [], db: true }), ["backend"]);
  assert.ok(workspacesFor({ workspaces: [], db: false }).length > 3);
  assert.deepEqual(workspacesFor({ workspaces: ["agent"], db: true }), ["agent"]);
});

test("decideTarget: the box only when a valid host is set, reachable, and --local wasn't given", () => {
  assert.deepEqual(decideTarget({ host: "box" }), { remote: true });
  assert.equal(decideTarget({ host: null }).remote, false);
  assert.match(decideTarget({ host: null }).reason, /DEV_REMOTE_HOST is not set/);
  assert.match(decideTarget({ host: "box", reachable: false }).reason, /unreachable/);
  assert.match(decideTarget({ host: "-oBad" }).reason, /plain ssh destination/);
  assert.deepEqual(decideTarget({ host: "box", local: true }), { remote: false, reason: null });
});

test("fallback decision: a pre-test failure falls back unless --no-fallback; failed tests never do", () => {
  assert.equal(onPrefailure({ noFallback: false }), "fallback");
  assert.equal(onPrefailure({ noFallback: true }), "fail");
  assert.equal(classifyRun({ code: 0, started: true }), "passed");
  assert.equal(classifyRun({ code: 1, started: true }), "tests-failed");
  assert.equal(classifyRun({ code: 255, started: false }), "prefailure");
  assert.equal(classifyRun({ code: 1, started: false }), "prefailure");
});

test("vitestArgs: db defaults to the .db.test.ts filter, explicit files win", () => {
  assert.deepEqual(vitestArgs({ db: true, files: [], workers: 6 }), ["run", "--maxWorkers=6", ".db.test.ts"]);
  assert.deepEqual(vitestArgs({ db: true, files: ["x.db.test.ts"], workers: 2 }), ["run", "--maxWorkers=2", "x.db.test.ts"]);
  assert.deepEqual(vitestArgs({ db: false, files: [], workers: 6 }), ["run", "--maxWorkers=6"]);
});

test("sshArgs sends the script as one base64 word, never raw", () => {
  const args = sshArgs("box", "echo 'hi'; $(x)");
  assert.deepEqual(args.slice(-3, -1), ["--", "box"]);
  const cmd = args.at(-1);
  assert.ok(!cmd.includes("$(x)") && !cmd.includes("'hi'"));
  const b64 = /printf %s ([A-Za-z0-9+/=]+) \|/.exec(cmd)[1];
  assert.equal(Buffer.from(b64, "base64").toString(), "echo 'hi'; $(x)");
  assert.ok(args.includes("BatchMode=yes") && args.includes("ConnectTimeout=5"));
  assert.throws(() => sshArgs("-oProxyCommand=x", "true"), /plain ssh destination/);
});

test("buildTestScript quotes values, keeps node_modules, installs only on a lockfile change and marks the test start", () => {
  const s = buildTestScript({ name: "feat-x", sha: SHA, workspaces: ["backend"], db: true, files: ["a b.test.ts", "it's.test.ts"], workers: 6 });
  assert.match(s, new RegExp(`checkout -q -f --detach '${SHA}'`));
  assert.match(s, /git clean -fdxq -e node_modules/);
  assert.match(s, /remote-lockhash/);
  assert.match(s, /REQUIRE_DB=1 npx --no-install vitest 'run' '--maxWorkers=6' 'a b.test.ts' 'it'\\''s.test.ts'/);
  assert.ok(s.indexOf(TESTS_START) > s.indexOf("npm ci"));
  assert.throws(() => buildTestScript({ name: "a b", sha: SHA, workspaces: ["backend"], db: false, files: [], workers: 6 }));
  assert.throws(() => buildTestScript({ name: "ok", sha: "HEAD; id", workspaces: ["backend"], db: false, files: [], workers: 6 }));
  assert.throws(() => buildTestScript({ name: "ok", sha: SHA, workspaces: ["backend; id"], db: false, files: [], workers: 6 }));
  assert.throws(() => buildTestScript({ name: "ok", sha: SHA, workspaces: ["backend"], db: false, files: [], workers: "6; id" }));
});

test("parseCiImage reads the pinned image and Playwright version from e2e.yml", () => {
  const yml = `    container: mcr.microsoft.com/playwright:v1.64.1-noble@sha256:${DIGEST}\n    env:\n`;
  assert.deepEqual(parseCiImage(yml), { image: `mcr.microsoft.com/playwright:v1.64.1-noble@sha256:${DIGEST}`, version: "1.64.1" });
  assert.equal(parseCiImage("container: ubuntu:latest"), null);
});

test("buildBaselinesScript mirrors CI's container env and command, in a separate checkout", () => {
  const image = `mcr.microsoft.com/playwright:v1.64.1-noble@sha256:${DIGEST}`;
  const s = buildBaselinesScript({ name: "feat-x", sha: SHA, image, version: "1.64.1" });
  assert.match(s, /docker run --rm --user/);
  assert.match(s, /-e CI=true -e PLAYWRIGHT_SNAPSHOTS=1/);
  assert.match(s, /npm run e2e -w frontend -- --update-snapshots=changed/);
  assert.match(s, /"\$ROOT\/"'feat-x\.pw'/);
  assert.ok(!/--ipc/.test(s)); // CI's container does not use it
  assert.throws(() => buildBaselinesScript({ name: "x", sha: SHA, image: "evil; id", version: "1" }));
});

test("fetch and clean scripts validate and quote", () => {
  assert.match(buildFetchScript({ name: "feat-x", folder: "frontend/e2e/__screenshots__" }), /find \. -type f -name '\*\.png' -print0 \| tar --null --format=ustar -T - -cf -/);
  assert.throws(() => buildFetchScript({ name: "x", folder: "../etc" }));
  assert.match(buildCleanScript("feat-x"), /refs\/remote-test\/feat-x/);
  assert.match(buildCleanScript(null), /rm -rf "\$HOME\/remote-test" "\$HOME\/remote-test\.git"/);
  assert.throws(() => buildCleanScript("a; id"));
});

// ---- hostile box output -------------------------------------------------------------------------------------------

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("pixels")]);

/** A tiny ustar writer: entries are { name, data?, type?, prefix?, link? }. */
function tar(entries) {
  const parts = [];
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0);
    const h = Buffer.alloc(512);
    h.write(e.name, 0, "latin1");
    h.write("0000644\0", 100);
    h.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    h.write(e.type ?? "0", 156);
    if (e.link) h.write(e.link, 157, "latin1");
    h.write("ustar\0" + "00", 257, "latin1");
    if (e.prefix) h.write(e.prefix, 345, "latin1");
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function listFiles(dir) {
  return readdirSync(dir, { recursive: true });
}

test("extractPngTar writes a normal archive (directories, prefix, nested names)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tar-ok-"));
  try {
    const names = extractPngTar(tar([
      { name: "desktop", type: "5" },
      { name: "desktop/map.png", data: PNG },
      { name: "b.png", data: PNG, prefix: "mobile/deep" },
    ]), dir);
    assert.deepEqual(names, ["desktop/map.png", "mobile/deep/b.png"]);
    assert.deepEqual(readFileSync(join(dir, "mobile/deep/b.png")), PNG);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extractPngTar rejects the whole archive for anything but regular .png files, writing nothing", () => {
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_FILE_BYTES)]);
  const cases = {
    symlink: [{ name: "x.png", type: "2", link: "../../.ssh/id_ed25519" }],
    hardlink: [{ name: "x.png", type: "1", link: "ok.png" }],
    pax: [{ name: "pax", type: "x", data: Buffer.from("20 path=a.png\n") }],
    gnuLongName: [{ name: "././@LongLink", type: "L", data: Buffer.from("a.png\0") }],
    fifo: [{ name: "x.png", type: "6" }],
    parent: [{ name: "../x.png", data: PNG }],
    parentMid: [{ name: "a/../x.png", data: PNG }],
    absolute: [{ name: "/etc/x.png", data: PNG }],
    backslash: [{ name: "a\\x.png", data: PNG }],
    notPng: [{ name: "x.txt", data: PNG }],
    badSignature: [{ name: "x.png", data: Buffer.from("not a png at all") }],
    oversize: [{ name: "x.png", data: big }],
  };
  for (const [label, entries] of Object.entries(cases)) {
    const dir = mkdtempSync(join(tmpdir(), "tar-bad-"));
    try {
      // a valid file first proves that nothing is applied when a later entry is bad
      assert.throws(() => extractPngTar(tar([{ name: "ok.png", data: PNG }, ...entries]), dir), /tar:/, label);
      assert.deepEqual(listFiles(dir), [], label);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("stripControl drops ESC, OSC/BEL and other control bytes but keeps tab, newline and CR", () => {
  assert.equal(stripControl("a\x1b]52;c;ZXZpbA==\x07b"), "a]52;c;ZXZpbA==b");
  assert.equal(stripControl("\x1b[31mred\x1b[0m\ttab\r\n\x7f\x9b\x00"), "[31mred[0m\ttab\r\n");
  assert.ok(!stripControl("x\x1b").includes("\x1b"));
});

test("isWorkspace rejects a leading dash", () => {
  assert.ok(isWorkspace("backend") && isWorkspace("packages/shared"));
  assert.ok(!isWorkspace("-x") && !isWorkspace("--help") && !isWorkspace("a/../b"));
});

test("createStateCommit --untracked ships tracked-but-ignored files and never untracked ignored ones", () => {
  const repo = mkdtempSync(join(tmpdir(), "state-"));
  const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    writeFileSync(join(repo, ".gitignore"), "*.secret\n");
    writeFileSync(join(repo, "tracked.secret"), "t");
    writeFileSync(join(repo, "a.txt"), "a");
    git("add", "-f", ".");
    git("commit", "-q", "-m", "init");
    writeFileSync(join(repo, "new.txt"), "n");
    writeFileSync(join(repo, "untracked.secret"), "s");
    const { sha } = createStateCommit(repo, { untracked: true });
    const files = git("ls-tree", "-r", "--name-only", sha).split("\n");
    assert.deepEqual(files.sort(), [".gitignore", "a.txt", "new.txt", "tracked.secret"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
