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
  let stopped = false;
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
      if (op === "run-task") return opts.noStart ? { tasks: [], failures: [{ reason: "RESOURCE:CPU" }] } : { tasks: [{ taskArn: TASK }] };
      if (op === "stop-task") return (stopped = true), {};
      if (op === "describe-tasks") {
        const dead = stopped || (opts.diesAt !== undefined && t >= opts.diesAt);
        return {
          tasks: [{
            lastStatus: dead ? "STOPPED" : "RUNNING",
            stoppedReason: dead && !stopped ? "Essential container in task exited" : undefined,
            containers: [
              { name: "postgres", exitCode: dead ? 0 : undefined },
              { name: "db-previous", exitCode: opts.previousExit ?? 0 },
              { name: "db-setup", exitCode: opts.setupExit ?? 0 },
              { name: "backend", exitCode: dead ? 137 : undefined },
              { name: "cloudflared", exitCode: dead ? 137 : undefined },
            ],
          }],
        };
      }
      if (op === "filter-log-events") return { events: [{ message: `boom at postgres://u:p@h/db (${arg("--log-stream-names")})` }] };
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
  assert.ok(!ops(deps).includes("filter-log-events"), "no log tail on success");
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
    assert.ok(ops(deps).includes("filter-log-events"));
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

test("resolveAuto: a commit that published no images is a green skip", () => {
  const logs = [];
  const none = { inspect: () => { throw new Error("manifest unknown"); }, log: (s) => logs.push(s) };
  assert.deepEqual(resolveAuto(none, SHA), { sha: SHA, backend: "", ops: "", skip: "true" });
  assert.match(logs[0], /no published images for aaaaaaaa/);
  assert.throws(() => resolveAuto(none, "main"), /not a full commit sha/);
});

test("the staging hostname and user are the ones the setup created", () => {
  assert.equal(STAGING.url, "https://api-staging.satis-manager.com");
  assert.equal(STAGING.user, "staging-admin");
});
