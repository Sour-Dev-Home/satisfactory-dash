import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STAGING, resolveAuto, staging } from "./deploy.mjs";
import { checkStagingBase, checkStagingNetwork, cloudflaredPin, imageRef, revisionWith } from "./lib.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ECS_TF = readFileSync(path.join(ROOT, "infra/aws/ecs.tf"), "utf8");
const PIN = cloudflaredPin(ECS_TF);
const SHA = "a".repeat(40);
const D = (c) => `sha256:${c.repeat(64)}`;
const PG = `public.ecr.aws/docker/library/postgres:18@sha256:${"e".repeat(64)}`;
const TASK = "arn:aws:ecs:us-east-1:123456789012:task/satis-staging/t123";
const NET = { awsvpcConfiguration: { subnets: ["subnet-0a1", "subnet-0b2"], securityGroups: ["sg-0abc"], assignPublicIp: "ENABLED" } };

const stagingBase = () => ({
  taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789012:task-definition/satis-staging:1",
  family: "satis-staging",
  executionRoleArn: "arn:aws:iam::123456789012:role/satis-staging-ecs-execution",
  containerDefinitions: [
    { name: "postgres", image: PG },
    { name: "db-previous", image: imageRef("ops", D("0")) },
    { name: "db-setup", image: imageRef("ops", D("0")) },
    { name: "backend", image: imageRef("backend", D("0")) },
    { name: "cloudflared", image: PIN },
  ],
});

const target = { sha: SHA, backend: D("3"), ops: D("4") };
const ENV = { STAGING_ADMIN_PASSWORD: "pw", CF_ACCESS_CLIENT_ID: "id.access", CF_ACCESS_CLIENT_SECRET: "secret" };

/** A fake AWS and a fake staging backend behind Access. `opts` shapes the story. */
function fakeDeps(opts = {}) {
  const calls = [];
  const logs = [];
  const requests = [];
  let t = 0;
  const stoppedTasks = new Set();
  let runs = 0;
  let describes = 0;
  // ADR-0054 D2: tasks 1..pullFails stop at once with a pull failure; a later one runs normally.
  const PULL = "CannotPullContainerError: ref pull has been retried 1 time(s): failed to resolve reference";
  const params = new Map([
    ["/satis/deploy/prod/released", opts.released ?? JSON.stringify({ sha: "b".repeat(40), backend: D("5"), ops: D("6"), taskDefinition: "x", previous: null })],
    ["/satis/deploy/staging/task-definition", "arn:aws:ecs:us-east-1:123456789012:task-definition/satis-staging:1"],
    ["/satis/deploy/staging/network", JSON.stringify(opts.network ?? NET)],
  ]);
  return {
    calls,
    logs,
    requests,
    env: opts.env ?? ENV,
    aws(args, input) {
      calls.push({ args, input });
      const [svc, op] = args;
      const arg = (n) => args[args.indexOf(n) + 1];
      if (svc === "ssm" && op === "get-parameter") return params.get(arg("--name"));
      if (op === "describe-task-definition") return { taskDefinition: { ...stagingBase(), ...opts.base } };
      if (op === "register-task-definition") return { taskDefinition: { taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789012:task-definition/satis-staging:2" } };
      if (op === "run-task") return opts.noStart ? { tasks: [], failures: [{ reason: "RESOURCE:CPU" }] } : { tasks: [{ taskArn: runs++ === 0 ? TASK : `${TASK}-${runs}` }] };
      if (op === "stop-task") return stoppedTasks.add(arg("--task")), {};
      if (op === "describe-tasks") {
        describes++;
        const arn = arg("--tasks");
        const n = arn === TASK ? 1 : Number(arn.split("-").pop());
        const stopped = stoppedTasks.has(arn);
        const pullFailed = n <= (opts.pullFails ?? 0);
        if (opts.describeThrowsWhenStopping && stopped) throw new Error("ThrottlingException\nrate exceeded");
        const lag = describes <= (opts.exitLag ?? 0);
        const dead = stopped || pullFailed || (opts.diesAt !== undefined && t >= opts.diesAt);
        return {
          tasks: [{
            lastStatus: dead ? "STOPPED" : "RUNNING",
            stoppedReason: pullFailed ? PULL : dead && !stopped ? (opts.stopReason ?? "Essential container in task exited") : undefined,
            containers: [
              { name: "postgres", exitCode: dead ? 0 : undefined },
              { name: "db-previous", exitCode: lag ? undefined : (opts.previousExit ?? 0) },
              { name: "db-setup", exitCode: lag ? undefined : (opts.setupExit ?? 0) },
              { name: "backend", exitCode: dead ? 137 : undefined },
              { name: "cloudflared", exitCode: dead ? 137 : undefined },
            ],
          }],
        };
      }
      if (op === "get-log-events") return { events: [{ message: `boom at postgres://u:p@h/db (${arg("--log-stream-name")})` }] };
      throw new Error(`unexpected aws ${args.join(" ")}`);
    },
    readFile: (p) => (p === "infra/aws/ecs.tf" ? ECS_TF : ""),
    async fetch(url, init = {}) {
      requests.push({ url, init });
      const p = new URL(url).pathname;
      const headers = init.headers ?? {};
      if (headers["CF-Access-Client-Id"] !== "id.access") return { status: 302, headers: new Headers() };
      if (p === "/api/health") return { status: t >= (opts.upAt ?? 0) ? 200 : 502 };
      if (p === "/api/health/ready") return { status: opts.ready ?? 200 };
      if (p === "/api/auth/login") {
        const ok = JSON.parse(init.body).password === "pw" && opts.login !== false;
        return { status: ok ? 200 : 401, headers: { getSetCookie: () => (ok ? ["satis_session=abc; Path=/api; HttpOnly; Secure"] : []) } };
      }
      const signedIn = headers.cookie === "satis_session=abc";
      if (p === "/api/auth/session") return { status: 200, json: async () => ({ authenticated: signedIn }) };
      if (p === "/api/servers") return { status: signedIn ? 200 : 401, json: async () => ({ servers: opts.servers ?? [] }) };
      return { status: 404 };
    },
    sleep: async (ms) => { t += ms; },
    now: () => t,
    log: (s) => logs.push(s),
  };
}

const ops = (d) => d.calls.map((c) => c.args[1]);

test("staging: three images swapped, the published network, health, sign-in, session, empty list, and always stopped", async () => {
  const deps = fakeDeps({ upAt: 30_000 });
  await staging(deps, target);
  const reg = deps.calls.find((c) => c.args[1] === "register-task-definition").input;
  const image = (n) => reg.containerDefinitions.find((c) => c.name === n).image;
  assert.equal(image("backend"), imageRef("backend", D("3")));
  assert.equal(image("db-setup"), imageRef("ops", D("4")));
  assert.equal(image("db-previous"), imageRef("ops", D("6")), "the released ops image migrates first");
  assert.equal(image("postgres"), PG);
  assert.equal(image("cloudflared"), PIN);
  const run = deps.calls.find((c) => c.args[1] === "run-task").args;
  assert.deepEqual(JSON.parse(run[run.indexOf("--network-configuration") + 1]), NET);
  assert.equal(run[run.indexOf("--cluster") + 1], "satis-staging");
  assert.ok(ops(deps).includes("stop-task"));
  assert.ok(deps.requests.every((r) => r.init.headers?.["CF-Access-Client-Secret"] === "secret"), "every request carries the Access token");
  assert.ok(!deps.logs.join("\n").includes("secret"), "the Access secret is never logged");
  assert.ok(!ops(deps).includes("get-log-events"), "no log tail on success");
});

test("nothing released yet: db-previous runs this release's ops image on a fresh database", async () => {
  const deps = fakeDeps({ released: "{}" });
  await staging(deps, target);
  const reg = deps.calls.find((c) => c.args[1] === "register-task-definition").input;
  assert.equal(reg.containerDefinitions.find((c) => c.name === "db-previous").image, imageRef("ops", D("4")));
});

for (const [name, opts, pattern] of [
  ["a failed previous-release migration", { previousExit: 1 }, /db-previous exited 1/],
  ["a failed migration of this release", { setupExit: 3 }, /db-setup exited 3/],
  ["ready not answering", { ready: 503 }, /ready answered 503/],
  ["a wrong password", { login: false }, /sign-in answered 401/],
  ["a server list that isn't empty", { servers: [{ id: "x" }] }, /server list is not empty/],
  ["a task that dies before answering", { upAt: 10 ** 9, diesAt: 20_000 }, /stopped before it answered/],
  ["a task that never answers", { upAt: 10 ** 12 }, /did not answer \/api\/health within 8 minutes/],
]) {
  test(`staging fails on ${name}, stops the task and prints the log tails, redacted`, async () => {
    const deps = fakeDeps(opts);
    await assert.rejects(staging(deps, target), pattern);
    assert.ok(ops(deps).includes("stop-task"), "always stopped");
    assert.ok(ops(deps).includes("get-log-events"));
    const logged = deps.logs.join("\n");
    assert.match(logged, /postgres:\/\/\[redacted\]/);
    assert.doesNotMatch(logged, /u:p@h/);
    assert.match(logged, /db-setup exit/);
  });
}

test("a task that never starts fails before anything is tested, and there is nothing to stop", async () => {
  const deps = fakeDeps({ noStart: true });
  await assert.rejects(staging(deps, target), /did not start.*RESOURCE:CPU/);
  assert.ok(!ops(deps).includes("stop-task"));
});

test("staging refuses a base or network that isn't Terraform's, before registering anything", async () => {
  for (const opts of [
    { base: { executionRoleArn: "arn:aws:iam::123456789012:role/satis-prod-ecs-execution" } },
    { base: { taskRoleArn: "arn:aws:iam::123456789012:role/anything" } },
    { base: { containerDefinitions: stagingBase().containerDefinitions.slice(1) } },
    { network: { awsvpcConfiguration: { ...NET.awsvpcConfiguration, securityGroups: ["sg-0abc", "sg-0prod"] } } },
    { network: { awsvpcConfiguration: { ...NET.awsvpcConfiguration, assignPublicIp: "DISABLED" } } },
  ]) {
    const deps = fakeDeps(opts);
    await assert.rejects(staging(deps, target), /not what Terraform applied|published staging network/);
    assert.ok(!ops(deps).includes("register-task-definition"));
  }
});

test("staging needs its three secrets and a resolved target", async () => {
  await assert.rejects(staging(fakeDeps({ env: { ...ENV, CF_ACCESS_CLIENT_SECRET: "" } }), target), /must be set/);
  await assert.rejects(staging(fakeDeps(), { sha: SHA, backend: D("1") }), /resolved sha and both digests/);
});

test("checkStagingBase and checkStagingNetwork", () => {
  assert.deepEqual(checkStagingBase(stagingBase(), { cloudflared: PIN }), []);
  const pgOff = stagingBase();
  pgOff.containerDefinitions[0].image = "postgres:18";
  assert.match(checkStagingBase(pgOff, { cloudflared: PIN }).join(), /postgres image/);
  assert.deepEqual(checkStagingNetwork(NET), NET);
  assert.throws(() => checkStagingNetwork({ awsvpcConfiguration: { ...NET.awsvpcConfiguration, extra: 1 } }), /published staging network/);
  assert.throws(() => checkStagingNetwork(null), /published staging network/);
});

test("revisionWith swaps several images and leaves the base alone", () => {
  const base = stagingBase();
  const copy = revisionWith(base, { backend: "b", "db-setup": "s" });
  assert.deepEqual(copy.containerDefinitions.map((c) => c.image), [PG, imageRef("ops", D("0")), "s", "b", PIN]);
  assert.equal(base.containerDefinitions[3].image, imageRef("backend", D("0")));
  assert.throws(() => revisionWith(base, { nope: "x" }), /no nope container/);
});


test("the staging hostname and user are the ones the setup created", () => {
  assert.equal(STAGING.url, "https://api-staging.satis-manager.com");
  assert.equal(STAGING.user, "staging-admin");
});

test("a setup container's exit code that describe-tasks shows late is waited for, not failed", async () => {
  // describe 1 is the up-poll; the exit check then sees no exitCode for two more reads.
  const deps = fakeDeps({ exitLag: 3 });
  await staging(deps, target);
  assert.ok(ops(deps).includes("stop-task"));
});

test("an exit code that never appears fails as 'without finishing' and still stops the task", async () => {
  const deps = fakeDeps({ exitLag: 10 ** 6 });
  await assert.rejects(staging(deps, target), /exited without finishing/);
  assert.ok(ops(deps).includes("stop-task"));
});

test("a describe-tasks that throws while stopping neither masks the failure nor skips the log tails", async () => {
  const deps = fakeDeps({ ready: 503, describeThrowsWhenStopping: true });
  await assert.rejects(staging(deps, target), /ready answered 503/);
  assert.ok(ops(deps).includes("get-log-events"));
  assert.match(deps.logs.join("\n"), /describe-tasks failed \(ThrottlingException\)/);
});

test("log tails read the newest lines of <container>/<container>/<task id>", async () => {
  const deps = fakeDeps({ ready: 503 });
  await assert.rejects(staging(deps, target));
  const calls = deps.calls.filter((c) => c.args[1] === "get-log-events").map((c) => c.args);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((a) => a.includes("--no-start-from-head")), "the end of the stream, not the start");
  assert.equal(calls[3][calls[3].indexOf("--log-stream-name") + 1], "backend/backend/t123");
});

test("Access's 302 (a rejected service token) fails at once, never as healthy, and nothing follows a redirect", async () => {
  const deps = fakeDeps({ env: { ...ENV, CF_ACCESS_CLIENT_ID: "wrong" } });
  await assert.rejects(staging(deps, target), /Cloudflare Access answered 302/);
  assert.equal(deps.requests.length, 1, "no waiting out the 8 minutes");
  assert.ok(ops(deps).includes("stop-task"));
});

test("the sign-in POST never follows a redirect (it carries the Access secret and the password)", async () => {
  const deps = fakeDeps();
  await staging(deps, target);
  const login = deps.requests.find((r) => r.url.endsWith("/api/auth/login"));
  assert.equal(login.init.redirect, "manual");
  assert.ok(deps.requests.every((r) => r.init.redirect === "manual"));
});

test("a fetch that throws during the health poll is retried like a 502", async () => {
  const deps = fakeDeps();
  const real = deps.fetch;
  let n = 0;
  deps.fetch = async (u, i) => { if (new URL(u).pathname === "/api/health" && n++ < 2) throw new Error("ECONNRESET"); return real(u, i); };
  await staging(deps, target);
});

test("a login that sets several cookies sends them all, without attributes", async () => {
  const deps = fakeDeps();
  const real = deps.fetch;
  deps.fetch = async (u, i) => {
    const r = await real(u, i);
    if (new URL(u).pathname === "/api/auth/login") r.headers = { getSetCookie: () => ["satis_session=abc; Path=/api; HttpOnly; Secure", "other=1; Path=/"] };
    return r;
  };
  await assert.rejects(staging(deps, target), /does not read as signed in/);
  const session = deps.requests.find((r) => r.url.endsWith("/api/auth/session"));
  assert.equal(session.init.headers.cookie, "satis_session=abc; other=1");
});

test("a login with no Set-Cookie fails", async () => {
  const deps = fakeDeps();
  const real = deps.fetch;
  deps.fetch = async (u, i) => {
    const r = await real(u, i);
    if (new URL(u).pathname === "/api/auth/login") r.headers = { getSetCookie: () => [] };
    return r;
  };
  await assert.rejects(staging(deps, target), /no session cookie/);
});

test("revisionWith: an empty map is a clean copy; a released record without ops is refused", async () => {
  const base = stagingBase();
  const copy = revisionWith(base, {});
  assert.deepEqual(copy.containerDefinitions, base.containerDefinitions);
  assert.notEqual(copy.containerDefinitions, base.containerDefinitions);
  const bad = JSON.stringify({ sha: "b".repeat(40), backend: D("5"), taskDefinition: "x", previous: null });
  const deps = fakeDeps({ released: bad });
  await assert.rejects(staging(deps, target), /released\.ops is missing/);
  assert.ok(!ops(deps).includes("run-task"));
});


// An index with both platforms whose revision label is `sha`, as `docker buildx imagetools inspect --format '{{json .}}'`.
const published = (sha, digest) => ({
  manifest: { digest, manifests: [{ platform: { os: "linux", architecture: "amd64" } }, { platform: { os: "linux", architecture: "arm64" } }] },
  image: { "linux/amd64": { config: { Labels: { "org.opencontainers.image.revision": sha } } }, "linux/arm64": { config: { Labels: { "org.opencontainers.image.revision": sha } } } },
});
const NEWER = "c".repeat(40);
const OLDER = "d".repeat(40);
/** A registry where only `images` (sha -> [backend, ops] digests) are published. */
const registry = (images, error) => ({
  inspect: (ref) => {
    if (error) throw new Error(error);
    const [repo, sha] = ref.split(":").slice(-2);
    const found = images[sha];
    if (!found) throw new Error(`ERROR: ${ref}: not found`);
    return published(sha, repo.endsWith("-backend") ? found[0] : found[1]);
  },
  recentShas: () => [NEWER, SHA, OLDER],
  log() {},
});

test("resolveAuto: the newest published images on main, even when the triggering commit published none (coalesced runs)", () => {
  // The run is for NEWER (no backend change); SHA, a merge before it, did publish: it must still ship.
  assert.deepEqual(resolveAuto(registry({ [SHA]: [D("1"), D("2")] }), NEWER), { sha: SHA, backend: D("1"), ops: D("2"), inputs: "", skip: "false" });
  // The triggering commit's own images when it published them.
  assert.equal(resolveAuto(registry({ [NEWER]: [D("3"), D("4")], [SHA]: [D("1"), D("2")] }), SHA).sha, NEWER);
  // Nothing published anywhere in reach: a green skip.
  assert.equal(resolveAuto(registry({}), NEWER).skip, "true");
  assert.throws(() => resolveAuto(registry({}), "main"), /not a full commit sha/);
});

test("resolveAuto fails loudly on anything but a missing image, never shipping an older release instead", () => {
  for (const m of ["dial tcp: i/o timeout", "unauthorized: authentication required", "Cannot connect to the Docker daemon"]) {
    assert.throws(() => resolveAuto(registry({}, m), SHA), new RegExp(m.split(" ")[0]));
  }
  const wrong = { inspect: () => ({ manifest: { digest: D("1"), manifests: [{ platform: { os: "linux", architecture: "amd64" } }] } }), recentShas: () => [SHA], log() {} };
  assert.throws(() => resolveAuto(wrong, SHA), /arm64/);
});

test("an automatic staging run skips images production already runs, before starting anything", async () => {
  const deps = fakeDeps({ released: JSON.stringify({ sha: SHA, backend: D("3"), ops: D("4"), taskDefinition: "x", previous: null }) });
  assert.deepEqual(await staging(deps, target, { ...STAGING, skipIfReleased: true }), { skipped: true, reason: "images" });
  assert.ok(!ops(deps).includes("register-task-definition") && !ops(deps).includes("run-task"));
  // A dispatched deploy may re-ship them on purpose.
  const again = fakeDeps({ released: JSON.stringify({ sha: SHA, backend: D("3"), ops: D("4"), taskDefinition: "x", previous: null }) });
  assert.equal((await staging(again, target)).skipped, undefined);
  assert.ok(ops(again).includes("run-task"));
});

// ADR-0054 D1: the build-inputs hash. A valid one is 64 hex characters.
const H = (c) => c.repeat(64);
const releasedWith = (extra) => JSON.stringify({ sha: "b".repeat(40), backend: D("5"), ops: D("6"), taskDefinition: "x", previous: null, ...extra });
const auto = { ...STAGING, skipIfReleased: true };

test("an automatic run skips new images built from the inputs production's release was built from", async () => {
  const deps = fakeDeps({ released: releasedWith({ inputs: H("a") }) });
  assert.deepEqual(await staging(deps, { ...target, inputs: H("a") }, auto), { skipped: true, reason: "inputs" });
  assert.ok(!ops(deps).includes("register-task-definition") && !ops(deps).includes("run-task"), "nothing registered or started");
  assert.match(deps.logs.join("\n"), /nothing deployable changed/);
});

for (const [name, released, inputs] of [
  ["different inputs", { inputs: H("a") }, H("b")],
  ["a release record from before the hash (no inputs)", {}, H("a")],
  ["images without the label", { inputs: H("a") }, undefined],
  ["neither side has a hash", {}, undefined],
  ["an empty hash on both sides", { inputs: "" }, ""],
  ["a malformed hash on both sides", { inputs: "zz" }, "zz"],
  ["an upper-case copy of the hash", { inputs: H("A") }, H("A")],
  ["a record hash that is not a string", { inputs: 7 }, 7],
]) {
  test(`an automatic run deploys on ${name}`, async () => {
    const deps = fakeDeps({ released: releasedWith(released) });
    const r = await staging(deps, { ...target, inputs }, auto);
    assert.equal(r.skipped, undefined);
    assert.ok(ops(deps).includes("run-task"));
  });
}

test("a dispatched deploy never skips, even on equal inputs or equal images", async () => {
  const deps = fakeDeps({ released: releasedWith({ inputs: H("a") }) });
  assert.equal((await staging(deps, { ...target, inputs: H("a") })).skipped, undefined);
  assert.ok(ops(deps).includes("run-task"));
  const same = fakeDeps({ released: releasedWith({ backend: D("3"), ops: D("4"), inputs: H("a") }) });
  assert.equal((await staging(same, { ...target, inputs: H("a") }, { ...STAGING, skipIfReleased: false })).skipped, undefined);
});

test("nothing released yet never skips on inputs", async () => {
  const deps = fakeDeps({ released: "{}" });
  assert.equal((await staging(deps, { ...target, inputs: H("a") }, auto)).skipped, undefined);
});

// ADR-0054 D2: a CannotPullContainerError stop retries once after 30 s.
const stoppedArns = (deps) => deps.calls.filter((c) => c.args[1] === "stop-task").map((c) => c.args[c.args.indexOf("--task") + 1]);
const runCount = (deps) => deps.calls.filter((c) => c.args[1] === "run-task").length;

test("a pull failure retries once after 30 s and passes; both tasks are stopped", async () => {
  const deps = fakeDeps({ pullFails: 1 });
  await staging(deps, target);
  const runs = deps.calls.filter((c) => c.args[1] === "run-task");
  assert.equal(runs.length, 2, "started twice");
  assert.equal(deps.calls.filter((c) => c.args[1] === "register-task-definition").length, 1, "the same revision both times");
  assert.deepEqual(runs[0].args, runs[1].args);
  assert.deepEqual(stoppedArns(deps), [TASK, `${TASK}-2`]);
  assert.ok(deps.now() >= 30_000, "waited 30 s");
  assert.match(deps.logs.join("\n"), /could not pull an image \(CannotPullContainerError.*starting it once more in 30 s/);
  assert.match(deps.logs.join("\n"), /all good/);
});

test("two pull failures fail the run, and the second task is stopped too", async () => {
  const deps = fakeDeps({ pullFails: 2 });
  await assert.rejects(staging(deps, target), /stopped before it answered \(CannotPullContainerError/);
  assert.equal(runCount(deps), 2, "only one retry");
  assert.deepEqual(stoppedArns(deps), [TASK, `${TASK}-2`]);
});

for (const reason of ["Essential container in task exited", "ResourceInitializationError: unable to pull secrets", "Task failed ELB health checks"]) {
  test(`any other stop does not retry (${reason})`, async () => {
    const deps = fakeDeps({ upAt: 10 ** 9, diesAt: 20_000, stopReason: reason });
    await assert.rejects(staging(deps, target), /stopped before it answered/);
    assert.equal(runCount(deps), 1);
  });
}

test("a retry whose run-task fails reports that and leaves nothing more to stop", async () => {
  const deps = fakeDeps({ pullFails: 1 });
  const aws = deps.aws;
  let n = 0;
  deps.aws = (args, input) => (args[1] === "run-task" && n++ === 1 ? { tasks: [], failures: [{ reason: "RESOURCE:MEMORY" }] } : aws(args, input));
  await assert.rejects(staging(deps, target), /did not start.*RESOURCE:MEMORY/);
  assert.deepEqual(stoppedArns(deps), [TASK], "only the first task, which ran");
});
