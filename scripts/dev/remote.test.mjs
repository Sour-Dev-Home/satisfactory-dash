import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBaselinesScript, buildCleanScript, buildFetchScript, buildTestScript, classifyRun, decideTarget, isHost, isName, isSha, onPrefailure,
  parseCiImage, parseTestArgs, sanitizeName, shq, sshArgs, TESTS_START, vitestArgs, workspacesFor,
} from "./remote.mjs";

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
  assert.match(buildFetchScript({ name: "feat-x", folder: "frontend/e2e/__screenshots__" }), /tar -cf - \./);
  assert.throws(() => buildFetchScript({ name: "x", folder: "../etc" }));
  assert.match(buildCleanScript("feat-x"), /refs\/remote-test\/feat-x/);
  assert.match(buildCleanScript(null), /rm -rf "\$HOME\/remote-test" "\$HOME\/remote-test\.git"/);
  assert.throws(() => buildCleanScript("a; id"));
});
