import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, production, resolveNewest, resolveSha } from "./deploy.mjs";
import { INPUTS_LABEL } from "./inputs.mjs";
import {
  alreadyReleased,
  inputsFromInspect,
  checkBackendBase,
  checkMigrateBase,
  cloudflaredPin,
  digestFromInspect,
  imageRef,
  nextReleased,
  noticeText,
  parseReleased,
  revisionFrom,
  rolloutStatus,
} from "./lib.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ECS_TF = readFileSync(path.join(ROOT, "infra/aws/ecs.tf"), "utf8");
const PIN = cloudflaredPin(ECS_TF);

const SHA = "a".repeat(40);
const OLD_SHA = "b".repeat(40);
const D = (c) => `sha256:${c.repeat(64)}`;
const ARN = (n) => `arn:aws:ecs:us-east-1:123456789012:task-definition/satis-prod:${n}`;
const MARN = (n) => `arn:aws:ecs:us-east-1:123456789012:task-definition/satis-prod-ops-db-migrate:${n}`;

const backendBase = () => ({
  taskDefinitionArn: ARN(10),
  family: "satis-prod",
  revision: 10,
  status: "ACTIVE",
  executionRoleArn: "arn:aws:iam::123456789012:role/satis-prod-ecs-execution",
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "512",
  memory: "1024",
  runtimePlatform: { cpuArchitecture: "ARM64", operatingSystemFamily: "LINUX" },
  containerDefinitions: [
    { name: "backend", image: imageRef("backend", D("1")), essential: true, secrets: [{ name: "SESSION_SECRET", valueFrom: "arn:aws:ssm:x" }] },
    { name: "cloudflared", image: PIN, essential: true },
  ],
  compatibilities: ["EC2", "FARGATE"],
  registeredAt: "2026-10-22T00:00:00Z",
});
const migrateBase = () => ({
  taskDefinitionArn: MARN(5),
  family: "satis-prod-ops-db-migrate",
  executionRoleArn: "arn:aws:iam::123456789012:role/satis-prod-ops-db-migrate",
  containerDefinitions: [{ name: "ops", image: imageRef("ops", D("2")) }],
});

const inspectOf = (digest, sha, platforms = ["linux/amd64", "linux/arm64"]) => ({
  manifest: { digest, manifests: [...platforms.map((p) => ({ platform: { os: p.split("/")[0], architecture: p.split("/")[1] } })), { platform: { os: "unknown", architecture: "unknown" } }] },
  image: Object.fromEntries(platforms.map((p) => [p, { config: { Labels: { "org.opencontainers.image.revision": sha } } }])),
});

/**
 * A fake AWS: records every call and answers like the CLI's JSON. `opts` shapes the story: alarm states over time,
 * the migrate exit code, whether a rollout completes.
 */
function fakeDeps(opts = {}) {
  const calls = [];
  const logs = [];
  const posts = [];
  let t = 0;
  let serviceTd = opts.serviceTd ?? ARN(9);
  let deployments = [{ status: "PRIMARY", taskDefinition: serviceTd, rolloutState: "COMPLETED" }];
  let registered = 10;
  let alarmPolls = 0;
  const params = new Map([
    ["/satis/deploy/prod/backend-task-definition", ARN(10)],
    ["/satis/deploy/prod/migrate-task-definition", MARN(5)],
    ["/satis/deploy/prod/released", opts.released ?? "{}"],
  ]);
  const deps = {
    calls,
    logs,
    posts,
    params,
    aws(args, input) {
      calls.push({ args, input });
      const [svc, op] = args;
      const arg = (name) => args[args.indexOf(name) + 1];
      if (svc === "ssm" && op === "get-parameter") return params.get(arg("--name"));
      if (svc === "ssm" && op === "put-parameter") return params.set(arg("--name"), arg("--value")), {};
      if (svc === "ecs" && op === "describe-task-definition") {
        const a = arg("--task-definition");
        return { taskDefinition: a.includes("ops-db-migrate") ? { ...migrateBase(), ...opts.migrateBase } : { ...backendBase(), ...opts.backendBase } };
      }
      if (svc === "ecs" && op === "register-task-definition") {
        registered += 1;
        return { taskDefinition: { taskDefinitionArn: input.family.includes("db-migrate") ? MARN(registered) : ARN(registered) } };
      }
      if (svc === "ecs" && op === "describe-services") {
        return { services: [{ taskDefinition: serviceTd, deployments, networkConfiguration: { awsvpcConfiguration: { subnets: ["s1"], securityGroups: ["g1"], assignPublicIp: "ENABLED" } } }] };
      }
      if (svc === "ecs" && op === "update-service") {
        const td = arg("--task-definition");
        const ok = opts.rollout?.(td) ?? true;
        deployments = ok
          ? [{ status: "PRIMARY", taskDefinition: td, rolloutState: "COMPLETED" }]
          : [{ status: "PRIMARY", taskDefinition: td, rolloutState: "FAILED", rolloutStateReason: "circuit breaker" }];
        if (ok) serviceTd = td;
        return {};
      }
      if (svc === "ecs" && op === "run-task") return opts.migrateStarts === false ? { tasks: [], failures: [{ reason: "RESOURCE:MEMORY" }] } : { tasks: [{ taskArn: "arn:aws:ecs:us-east-1:123456789012:task/satis-prod/abc123" }] };
      if (svc === "ecs" && op === "describe-tasks") return { tasks: [{ lastStatus: "STOPPED", containers: [{ exitCode: opts.migrateExit ?? 0 }], stoppedReason: "Essential container in task exited" }] };
      if (svc === "logs" && op === "get-log-events") return { events: [{ message: "migration 42 failed" }, { message: "connect to postgres://satis_migrator:pw@satis-prod.abc123.us-east-1.rds.amazonaws.com:5432/satis refused (satis-prod.abc123.us-east-1.rds.amazonaws.com)" }] };
      if (svc === "cloudwatch" && op === "describe-alarms") {
        const state = opts.alarmAt?.(alarmPolls++) ?? "OK";
        return { MetricAlarms: CONFIG.alarms.map((n, i) => ({ AlarmName: n, StateValue: i === 0 ? state : "OK" })) };
      }
      throw new Error(`unexpected aws ${args.join(" ")}`);
    },
    inspect: opts.inspect ?? (() => { throw new Error("no inspect"); }),
    recentShas: () => opts.recentShas ?? [],
    readFile: (p) => (p === "infra/aws/ecs.tf" ? ECS_TF : ""),
    fetch: async (url, init) => {
      if (init?.method === "POST") return posts.push({ url, body: JSON.parse(init.body) }), { ok: true, status: 204 };
      return { status: opts.health ?? 200 };
    },
    sleep: async (ms) => { t += ms; },
    now: () => t,
    log: (s) => logs.push(s),
    env: { DEPLOY_DISCORD_WEBHOOK: opts.webhook, GITHUB_RUN_ID: "77", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r" },
  };
  return deps;
}

const ops = (deps) => deps.calls.map((c) => `${c.args[0]} ${c.args[1]}`);
const target = { sha: SHA, backend: D("3"), ops: D("4") };

test("deploy: alarm pre-check, migrate on the new ops image, roll out, watch 10 minutes, health, record", async () => {
  const deps = fakeDeps({ webhook: "https://discord.example/hook" });
  const record = await production(deps, "deploy", target);
  const order = ops(deps).filter((o) => o !== "ssm get-parameter" && o !== "ecs describe-task-definition");
  assert.equal(order[0], "cloudwatch describe-alarms");
  const run = order.indexOf("ecs run-task");
  const update = order.indexOf("ecs update-service");
  assert.ok(run > 0 && update > run, "migrate runs before the service is touched");
  const regs = deps.calls.filter((c) => c.args[1] === "register-task-definition");
  assert.equal(regs[0].input.containerDefinitions[0].image, imageRef("ops", D("4")));
  const backendReg = regs[1].input;
  assert.equal(backendReg.containerDefinitions.find((c) => c.name === "backend").image, imageRef("backend", D("3")));
  assert.equal(backendReg.containerDefinitions.find((c) => c.name === "cloudflared").image, PIN);
  assert.equal(backendReg.tags, undefined);
  assert.equal(backendReg.taskDefinitionArn, undefined, "only registerable fields are sent");
  // 10 minutes of watching at 15 s.
  assert.ok(ops(deps).filter((o) => o === "cloudwatch describe-alarms").length >= 40);
  assert.deepEqual(record, { ...target, taskDefinition: ARN(12), previous: null });
  assert.deepEqual(JSON.parse(deps.params.get("/satis/deploy/prod/released")), record);
  assert.match(deps.posts[0].body.content, /Released \(deploy\) aaaaaaaa/);
  assert.deepEqual(deps.posts[0].body.allowed_mentions, { parse: [] });
});

test("a failed migration never touches the service, prints the log and says so", async () => {
  const deps = fakeDeps({ migrateExit: 1 });
  await assert.rejects(production(deps, "deploy", target), /db-migrate exited 1.*not touched/);
  assert.ok(!ops(deps).includes("ecs update-service"));
  assert.ok(deps.logs.some((l) => l.includes("migration 42 failed")));
  assert.equal(deps.params.get("/satis/deploy/prod/released"), "{}");
});

test("a migrate task that never starts ends the deploy too", async () => {
  const deps = fakeDeps({ migrateStarts: false });
  await assert.rejects(production(deps, "deploy", target), /did not start.*RESOURCE:MEMORY/);
  assert.ok(!ops(deps).includes("ecs update-service"));
});

test("an alarm already in ALARM stops a deploy before anything is registered", async () => {
  const deps = fakeDeps({ alarmAt: () => "ALARM" });
  await assert.rejects(production(deps, "deploy", target), /already in ALARM: satis-prod-backend-critical/);
  assert.ok(!ops(deps).includes("ecs register-task-definition"));
});

test("an alarm during the watch rolls back to the revision that ran before, and records nothing", async () => {
  const deps = fakeDeps({ alarmAt: (n) => (n >= 5 ? "ALARM" : "OK"), webhook: "https://discord.example/hook" });
  await assert.rejects(production(deps, "deploy", target), /rolled back: satis-prod-backend-critical/);
  const updates = deps.calls.filter((c) => c.args[1] === "update-service").map((c) => c.args[c.args.indexOf("--task-definition") + 1]);
  assert.deepEqual(updates, [ARN(12), ARN(9)]);
  assert.equal(deps.params.get("/satis/deploy/prod/released"), "{}");
  assert.equal(deps.posts.length, 1);
  assert.match(deps.posts[0].body.content, /Rolled back/);
});

test("a failed rollout (circuit breaker) fails the job without recording", async () => {
  const deps = fakeDeps({ rollout: () => false });
  await assert.rejects(production(deps, "deploy", target), /rollout failed: circuit breaker/);
  assert.equal(deps.params.get("/satis/deploy/prod/released"), "{}");
});

test("health must answer 200 before the release is recorded", async () => {
  const deps = fakeDeps({ health: 503 });
  await assert.rejects(production(deps, "deploy", target), /did not answer 200/);
  assert.equal(deps.params.get("/satis/deploy/prod/released"), "{}");
});

test("a base that is not what Terraform applied is refused before anything is registered", async () => {
  for (const backendBase of [
    { executionRoleArn: "arn:aws:iam::123456789012:role/evil" },
    { taskRoleArn: "arn:aws:iam::123456789012:role/satis-prod-ecs-execution" },
    { containerDefinitions: [{ name: "backend", image: "x" }, { name: "cloudflared", image: "cloudflare/cloudflared:latest" }] },
    { containerDefinitions: [{ name: "backend", image: "x" }, { name: "cloudflared", image: PIN }, { name: "sidecar", image: "x" }] },
  ]) {
    const deps = fakeDeps({ backendBase });
    await assert.rejects(production(deps, "deploy", target), /is not what Terraform applied/);
    assert.ok(!ops(deps).includes("ecs register-task-definition"));
  }
});

const released = (prev = true) =>
  JSON.stringify({
    sha: SHA,
    backend: D("3"),
    ops: D("4"),
    taskDefinition: ARN(12),
    previous: prev ? { sha: OLD_SHA, backend: D("5"), ops: D("6"), taskDefinition: ARN(8) } : null,
  });

test("rollback: released.previous's backend on the current base, no migration, no alarm pre-check", async () => {
  // The alarm that caused the rollback still reads ALARM: the rollback neither stops on it nor undoes itself.
  const deps = fakeDeps({ released: released(), serviceTd: ARN(12), alarmAt: () => "ALARM" });
  const firing = await production(deps, "rollback");
  assert.equal(firing.sha, OLD_SHA);
  assert.ok(!ops(deps).includes("cloudwatch describe-alarms"), "no pre-check and no watch after a rollback");
  const updates = deps.calls.filter((c) => c.args[1] === "update-service");
  assert.equal(updates.length, 1, "the service stays on the rollback revision");
  const fresh = fakeDeps({ released: released(), serviceTd: ARN(12) });
  const record = await production(fresh, "rollback");
  assert.ok(!ops(fresh).includes("ecs run-task"));
  const reg = fresh.calls.find((c) => c.args[1] === "register-task-definition").input;
  assert.equal(reg.containerDefinitions.find((c) => c.name === "backend").image, imageRef("backend", D("5")));
  assert.equal(record.sha, OLD_SHA);
  assert.equal(record.previous.sha, SHA, "the release rolled back from becomes previous");
});

test("rollback with nothing previous asks for a sha; redeploy with nothing released refuses", async () => {
  await assert.rejects(production(fakeDeps({ released: released(false), serviceTd: ARN(12) }), "rollback"), /no previous release/);
  await assert.rejects(production(fakeDeps(), "redeploy"), /nothing released yet/);
});

test("rollback when production isn't running the recorded release goes back to that release, not two back", async () => {
  // e.g. a deploy whose health check failed: its revision runs, but released still names the last good one.
  const deps = fakeDeps({ released: released(), serviceTd: ARN(13) });
  const record = await production(deps, "rollback");
  const reg = deps.calls.find((c) => c.args[1] === "register-task-definition").input;
  assert.equal(reg.containerDefinitions.find((c) => c.name === "backend").image, imageRef("backend", D("3")));
  assert.equal(record.sha, SHA);
  assert.ok(deps.logs.some((l) => /not the recorded release/.test(l)));
});

test("a deployment not listed yet right after update-service is waited for, not failed", async () => {
  const deps = fakeDeps();
  const real = deps.aws;
  let hidden = 2;
  deps.aws = (args, input) => {
    const r = real(args, input);
    if (args[1] === "describe-services" && deps.calls.some((c) => c.args[1] === "update-service") && hidden > 0) {
      hidden -= 1;
      return { services: [{ ...r.services[0], taskDefinition: ARN(9), deployments: [{ status: "PRIMARY", taskDefinition: ARN(9), rolloutState: "COMPLETED" }] }] };
    }
    return r;
  };
  const record = await production(deps, "deploy", target);
  assert.equal(record.taskDefinition, ARN(12));
});

test("the watch rides out a flaky alarm read, but three in a row stop it", async () => {
  const flaky = (failAt) => {
    const deps = fakeDeps();
    const real = deps.aws;
    let n = 0;
    deps.aws = (args, input) => {
      if (args[1] === "describe-alarms" && failAt(n++)) throw new Error("Throttling: Rate exceeded");
      return real(args, input);
    };
    return deps;
  };
  // Poll 0 is the pre-check; one failure in the watch is fine.
  assert.equal((await production(flaky((n) => n === 3), "deploy", target)).sha, SHA);
  await assert.rejects(production(flaky((n) => n >= 3 && n <= 5), "deploy", target), /could not read the alarms.*Rate exceeded/);
});

test("redeploy: the released digests on the current base, without a migration", async () => {
  const deps = fakeDeps({ released: released() });
  const record = await production(deps, "redeploy");
  assert.ok(!ops(deps).includes("ecs run-task"));
  assert.equal(record.backend, D("3"));
  assert.equal(record.previous.sha, OLD_SHA, "a redeploy keeps the real previous release, so a rollback still goes back");
  assert.equal(record.taskDefinition, ARN(11));
});

test("deploy refuses without a resolved sha and digests; unknown actions refuse", async () => {
  await assert.rejects(production(fakeDeps(), "deploy", { sha: SHA }), /resolved sha and both digests/);
  await assert.rejects(production(fakeDeps(), "deploy", { sha: "abc", backend: D("1"), ops: D("2") }), /resolved sha/);
  await assert.rejects(production(fakeDeps(), "destroy"), /unknown action/);
});

test("resolve: both digests for a sha, checked; newest skips commits without images", () => {
  const inspect = (ref) => {
    if (ref.endsWith(`:${OLD_SHA}`)) throw new Error("manifest unknown");
    return inspectOf(ref.includes("-backend:") ? D("7") : D("8"), SHA);
  };
  assert.deepEqual(resolveSha({ inspect }, SHA), { sha: SHA, backend: D("7"), ops: D("8"), inputs: "" });
  const logs = [];
  assert.deepEqual(resolveNewest({ inspect, recentShas: () => [OLD_SHA, SHA], log: (s) => logs.push(s) }), { sha: SHA, backend: D("7"), ops: D("8"), inputs: "" });
  assert.match(logs[0], /bbbbbbbb: manifest unknown/);
  assert.throws(() => resolveSha({ inspect }, "main"), /not a full commit sha/);
  assert.throws(() => resolveNewest({ inspect: () => { throw new Error("x"); }, recentShas: () => [SHA], log() {} }), /none of the last/);
});

test("digestFromInspect: arm64 required, every platform's revision label must be the sha", () => {
  assert.equal(digestFromInspect(inspectOf(D("9"), SHA), SHA), D("9"));
  assert.throws(() => digestFromInspect(inspectOf(D("9"), SHA, ["linux/amd64"]), SHA), /no linux\/arm64/);
  assert.throws(() => digestFromInspect(inspectOf(D("9"), OLD_SHA), SHA), /revision label is b+/);
  assert.throws(() => digestFromInspect({ manifest: { digest: "sha256:nope" } }, SHA), /no sha256 digest/);
  assert.throws(() => digestFromInspect({ manifest: { digest: D("9"), manifests: [{ platform: { os: "linux", architecture: "arm64" } }] } }, SHA), /no image configs/);
});

test("imageRef only names the two pinned repositories, by digest", () => {
  assert.equal(imageRef("ops", D("1")), `ghcr.io/sour-dev-home/satisfactory-dash-ops@${D("1")}`);
  assert.throws(() => imageRef("other", D("1")), /unknown image kind/);
  assert.throws(() => imageRef("backend", "latest"), /not a sha256 digest/);
});

test("the base checks and the copy", () => {
  assert.deepEqual(checkBackendBase(backendBase(), { environment: "prod", cloudflared: PIN }), []);
  assert.deepEqual(checkMigrateBase(migrateBase(), { environment: "prod" }), []);
  assert.match(checkMigrateBase({ ...migrateBase(), family: "satis-prod-ops-backup" }, { environment: "prod" }).join(), /family/);
  const base = backendBase();
  const copy = revisionFrom(base, "backend", "img");
  assert.equal(copy.containerDefinitions[0].image, "img");
  assert.equal(base.containerDefinitions[0].image, imageRef("backend", D("1")), "the base itself is untouched");
  assert.deepEqual(copy.containerDefinitions[0].secrets, base.containerDefinitions[0].secrets);
  assert.equal(copy.compatibilities, undefined);
  assert.throws(() => revisionFrom(base, "ops", "img"), /no ops container/);
});

test("the cloudflared pin is read from ecs.tf", () => {
  assert.match(PIN, /^cloudflare\/cloudflared:[\d.]+@sha256:[0-9a-f]{64}$/);
  assert.throws(() => cloudflaredPin("locals {}"), /no cloudflared_image pin/);
});

test("the release record", () => {
  assert.equal(parseReleased("{}"), null);
  assert.throws(() => parseReleased("[]"), /not an object/);
  assert.throws(() => parseReleased("nope"), /not JSON/);
  assert.throws(() => parseReleased('{"sha":"x"}'), /released.backend is missing/);
  const r1 = nextReleased(null, { sha: "1", backend: "b", ops: "o", taskDefinition: "t" });
  const r2 = nextReleased(r1, { sha: "2", backend: "b2", ops: "o2", taskDefinition: "t2" });
  assert.deepEqual(r2.previous, { sha: "1", backend: "b", ops: "o", taskDefinition: "t" });
  assert.equal(nextReleased(r2, { sha: "3", backend: "", ops: "", taskDefinition: "" }).previous.previous, undefined, "one level deep");
});

test("rolloutStatus", () => {
  const svc = (deployments, taskDefinition) => ({ deployments, taskDefinition });
  assert.equal(rolloutStatus(svc([{ status: "PRIMARY", taskDefinition: "n", rolloutState: "COMPLETED" }], "n"), "n").state, "done");
  assert.equal(rolloutStatus(svc([{ status: "PRIMARY", taskDefinition: "n", rolloutState: "IN_PROGRESS" }, { status: "ACTIVE", taskDefinition: "o" }], "o"), "n").state, "waiting");
  assert.equal(rolloutStatus(svc([{ status: "PRIMARY", taskDefinition: "o", rolloutState: "COMPLETED" }], "o"), "n").state, "failed");
  assert.match(rolloutStatus(svc([{ status: "PRIMARY", taskDefinition: "n", rolloutState: "FAILED", rolloutStateReason: "alarm" }], "o"), "n").reason, /alarm/);
});

test("the notice never pings and keeps the detail short", () => {
  const t = noticeText({ outcome: "failed", action: "deploy", sha: SHA, backend: D("1"), ops: D("2"), detail: "x".repeat(500), runUrl: "https://r" });
  assert.match(t, /^❌ Deploy failed \(deploy\) aaaaaaaa\nbackend 111111111111 · ops 222222222222\nx{300}\nhttps:\/\/r$/);
});

// ---- fresh-eyes pass ----

test("redeploy of a first release (no previous) records previous null", async () => {
  const deps = fakeDeps({ released: released(false) });
  assert.equal((await production(deps, "redeploy")).previous, null);
});

test("rollout: ECS keeps the old deployment ACTIVE; a circuit-breaker rollback is a failure", () => {
  const d = (status, taskDefinition, rolloutState, rolloutStateReason) => ({ status, taskDefinition, rolloutState, rolloutStateReason });
  // New PRIMARY done but the service field lags: still waiting.
  assert.equal(rolloutStatus({ taskDefinition: "o", deployments: [d("PRIMARY", "n", "COMPLETED"), d("ACTIVE", "o", "COMPLETED")] }, "n").state, "waiting");
  // Circuit breaker: old td is the new PRIMARY, ours FAILED.
  const rb = rolloutStatus({ taskDefinition: "o", deployments: [d("PRIMARY", "o", "IN_PROGRESS"), d("ACTIVE", "n", "FAILED", "tasks failed to start")] }, "n");
  assert.equal(rb.state, "failed");
  assert.match(rb.reason, /tasks failed/);
  // Rolling back to `before` while ours is still ACTIVE.
  assert.equal(rolloutStatus({ taskDefinition: "o", deployments: [d("PRIMARY", "o", "IN_PROGRESS"), d("ACTIVE", "n", "COMPLETED")] }, "o").state, "waiting");
  assert.equal(rolloutStatus({ taskDefinition: "o", deployments: [d("PRIMARY", "o", "COMPLETED"), d("ACTIVE", "n", "COMPLETED")] }, "o").state, "done");
  assert.equal(rolloutStatus(undefined, "n").state, "failed");
  assert.equal(rolloutStatus({}, "n").state, "failed");
});

test("a rollout that never completes times out and notifies once", async () => {
  const stuck = fakeDeps({ webhook: "https://d.example/h" });
  const real = stuck.aws;
  stuck.aws = (args, input) => {
    const out = real(args, input);
    if (args[1] === "describe-services") out.services[0].deployments = [{ status: "PRIMARY", taskDefinition: ARN(12), rolloutState: "IN_PROGRESS" }, { status: "ACTIVE", taskDefinition: ARN(9), rolloutState: "COMPLETED" }];
    return out;
  };
  await assert.rejects(production(stuck, "deploy", target), /rollout did not complete in time/);
  assert.equal(stuck.posts.length, 1);
  assert.match(stuck.posts[0].body.content, /Deploy failed/);
});

test("a failed rollback after an alarm is reported once, as a failure", async () => {
  const bad = fakeDeps({ alarmAt: (n) => (n === 1 ? "ALARM" : "OK"), rollout: (td) => td !== ARN(9), webhook: "https://d.example/h" });
  await assert.rejects(production(bad, "deploy", target), /rollout failed/);
  assert.equal(bad.posts.length, 1, "one notice only");
  assert.match(bad.posts[0].body.content, /Deploy failed/);
});

test("the alarm rollback goes to the revision that ran before, waits, notifies once, records nothing", async () => {
  const deps = fakeDeps({ alarmAt: (n) => (n === 3 ? "ALARM" : "OK"), webhook: "https://d.example/h" });
  await assert.rejects(production(deps, "deploy", target), /^Error: rolled back: satis-prod-backend-critical/);
  const updates = deps.calls.filter((c) => c.args[1] === "update-service").map((c) => c.args[c.args.indexOf("--task-definition") + 1]);
  assert.deepEqual(updates, [ARN(12), ARN(9)]);
  assert.equal(deps.posts.length, 1);
  assert.match(deps.posts[0].body.content, /Rolled back/);
  assert.ok(!deps.calls.some((c) => c.args[1] === "put-parameter"));
});

test("notice failures never fail the deploy, and the webhook call can time out", async () => {
  for (const fetchImpl of [async () => { throw new Error("dns"); }, async () => ({ ok: false, status: 500 })]) {
    const deps = fakeDeps({ webhook: "https://d.example/h" });
    const base = deps.fetch;
    deps.fetch = (url, init) => (init?.method === "POST" ? fetchImpl() : base(url, init));
    const record = await production(deps, "deploy", target);
    assert.equal(record.sha, SHA);
  }
  const deps = fakeDeps({ webhook: "https://d.example/h" });
  const base = deps.fetch;
  let signal;
  deps.fetch = (url, init) => { if (init?.method === "POST") signal = init.signal; return base(url, init); };
  await production(deps, "deploy", target);
  assert.ok(signal instanceof AbortSignal, "a hanging webhook must time out instead of hanging the deploy");
});

test("a failed deploy with a throwing webhook still reports the original error", async () => {
  const deps = fakeDeps({ migrateExit: 2, webhook: "https://d.example/h" });
  deps.fetch = async () => { throw new Error("dns"); };
  await assert.rejects(production(deps, "deploy", target), /db-migrate exited 2/);
});

test("parseReleased with odd values", () => {
  assert.equal(parseReleased(null), null);
  assert.equal(parseReleased(undefined), null);
  assert.throws(() => parseReleased(5), /not an object/);
  assert.throws(() => parseReleased({}), /not JSON/);
  assert.throws(() => parseReleased("null"), /not an object/);
  assert.throws(() => parseReleased(""), /not JSON/);
  const ok = { sha: "s", backend: "b", ops: "o", taskDefinition: "t" };
  assert.deepEqual(parseReleased(JSON.stringify({ ...ok, previous: null })), { ...ok, previous: null });
  assert.throws(() => parseReleased(JSON.stringify({ ...ok, previous: "x" })), /previous is not an object/);
  assert.throws(() => parseReleased(JSON.stringify({ ...ok, previous: { sha: "s" } })), /previous.backend is missing/);
});

test("revisionFrom does not mutate the base or share its objects, and keeps what ECS needs", () => {
  const base = backendBase();
  const snap = JSON.stringify(base);
  const input = revisionFrom(base, "backend", imageRef("backend", D("3")));
  assert.equal(JSON.stringify(base), snap);
  input.containerDefinitions[0].secrets.push("x");
  assert.equal(JSON.stringify(base), snap);
  for (const k of ["family", "executionRoleArn", "networkMode", "requiresCompatibilities", "cpu", "memory", "runtimePlatform"]) assert.deepEqual(input[k], base[k], k);
  assert.equal(input.revision, undefined);
  assert.equal("taskRoleArn" in input, false);
  assert.throws(() => revisionFrom({ family: "f" }, "backend", "i"), /no backend container/);
  assert.throws(() => revisionFrom(base, "ops", "i"), /no ops container/);
});

test("digestFromInspect: single-platform image shape and an index whose arm64 has no config", () => {
  const cfg = (sha) => ({ os: "linux", architecture: "arm64", config: { Labels: { "org.opencontainers.image.revision": sha } } });
  const arm = { platform: { os: "linux", architecture: "arm64" } };
  const single = (sha) => ({ manifest: { digest: D("9"), manifests: [arm] }, image: cfg(sha) });
  assert.equal(digestFromInspect(single(SHA), SHA), D("9"));
  assert.throws(() => digestFromInspect(single(OLD_SHA), SHA), /revision label is b+/);
  // arm64 is listed, but only amd64's config is present: the label of arm64 was never checked.
  const partial = { manifest: { digest: D("9"), manifests: [arm, { platform: { os: "linux", architecture: "amd64" } }] }, image: { "linux/amd64": cfg(SHA) } };
  assert.throws(() => digestFromInspect(partial, SHA), /no linux\/arm64 image config/);
  assert.throws(() => digestFromInspect(null, SHA), /no sha256 digest/);
  assert.throws(() => digestFromInspect({ manifest: { digest: D("9"), manifests: [arm] }, image: { "linux/arm64": { config: { Labels: null } } } }, SHA), /revision label is missing/);
});

test("resolveNewest and resolveSha edge cases", () => {
  assert.throws(() => resolveNewest({ inspect() {}, recentShas: () => [], log() {} }, 5), /none of the last 5/);
  assert.throws(() => resolveSha({ inspect() {} }, undefined), /not a full commit sha/);
});

test("rollback to a given sha needs digests, and chains previous one level", async () => {
  await assert.rejects(production(fakeDeps({ released: released() }), "rollback", { sha: OLD_SHA }), /needs its resolved digests/);
  const deps = fakeDeps({ released: released() });
  const record = await production(deps, "rollback", { sha: OLD_SHA, backend: D("5"), ops: D("6") });
  assert.equal(record.previous.sha, SHA);
  assert.equal(record.previous.previous, undefined);
});

test("the migrate log tail never shows a connection string or the database host (public Actions logs)", async () => {
  const deps = fakeDeps({ migrateExit: 1 });
  await assert.rejects(production(deps, "deploy", target), /db-migrate exited 1/);
  const tail = deps.logs.filter((l) => l.startsWith("  |")).join("\n");
  assert.match(tail, /postgres:\/\/\[redacted\]/);
  assert.match(tail, /\(\[rds host\]\)/);
  assert.doesNotMatch(tail, /pw@|rds\.amazonaws\.com/);
});

// --- ADR-0054 D1: build inputs ---

const H = (c) => c.repeat(64);
const labelled = (digest, sha, inputs, platforms = ["linux/amd64", "linux/arm64"]) => {
  const i = inspectOf(digest, sha, platforms);
  for (const [p, img] of Object.entries(i.image)) {
    const v = typeof inputs === "function" ? inputs(p) : inputs;
    if (v !== undefined) img.config.Labels[INPUTS_LABEL] = v;
  }
  return i;
};
const withInputs = (prev, inputs, prevInputs) =>
  JSON.stringify({
    sha: SHA, backend: D("3"), ops: D("4"), taskDefinition: ARN(12), ...(inputs === undefined ? {} : { inputs }),
    previous: prev ? { sha: OLD_SHA, backend: D("5"), ops: D("6"), taskDefinition: ARN(8), ...(prevInputs === undefined ? {} : { inputs: prevInputs }) } : null,
  });

test("alreadyReleased: equal valid inputs or equal digests match; nothing else does", () => {
  const rel = { sha: OLD_SHA, backend: D("5"), ops: D("6"), taskDefinition: "x", inputs: H("a") };
  const t = { sha: SHA, backend: D("3"), ops: D("4") };
  assert.equal(alreadyReleased(rel, { ...t, inputs: H("a") }), "inputs");
  assert.equal(alreadyReleased(rel, { ...t, backend: D("5"), ops: D("6") }), "images");
  assert.equal(alreadyReleased(rel, { ...t, inputs: H("b") }), null, "different inputs");
  assert.equal(alreadyReleased({ ...rel, inputs: undefined }, { ...t, inputs: H("a") }), null, "a record without inputs never matches");
  assert.equal(alreadyReleased(rel, t), null, "a target without inputs never matches");
  assert.equal(alreadyReleased({ ...rel, inputs: "" }, { ...t, inputs: "" }), null);
  assert.equal(alreadyReleased({ ...rel, inputs: "x" }, { ...t, inputs: "x" }), null, "only a valid hash matches");
  assert.equal(alreadyReleased({ ...rel, inputs: H("A") }, { ...t, inputs: H("A") }), null);
  assert.equal(alreadyReleased(null, { ...t, inputs: H("a") }), null, "nothing released yet");
  assert.equal(alreadyReleased(rel, { ...t, backend: D("5") }), null, "one digest alone is not the same images");
  assert.equal(alreadyReleased({ ...rel, previous: { inputs: H("c") } }, { ...t, inputs: H("c") }), null, "the previous release's inputs are not production's");
});

test("inputsFromInspect: the label only when every platform carries the same valid hash", () => {
  assert.equal(inputsFromInspect(labelled(D("1"), SHA, H("a"))), H("a"));
  assert.equal(inputsFromInspect(labelled(D("1"), SHA, undefined)), null, "no label");
  assert.equal(inputsFromInspect(labelled(D("1"), SHA, (p) => (p === "linux/arm64" ? H("a") : undefined))), null, "one platform unlabelled");
  assert.equal(inputsFromInspect(labelled(D("1"), SHA, (p) => (p === "linux/arm64" ? H("a") : H("b")))), null, "platforms disagree");
  assert.equal(inputsFromInspect(labelled(D("1"), SHA, "nothex")), null);
  assert.equal(inputsFromInspect({ manifest: {}, image: { config: { Labels: { [INPUTS_LABEL]: H("c") } }, os: "linux", architecture: "arm64" } }), H("c"), "single-platform shape");
  assert.equal(inputsFromInspect({}), null);
  assert.equal(inputsFromInspect(null), null);
});

test("resolveSha carries the inputs only when both images agree", () => {
  const reg = (b, o) => ({ inspect: (ref) => (ref.includes("-backend:") ? labelled(D("7"), SHA, b) : labelled(D("8"), SHA, o)) });
  assert.equal(resolveSha(reg(H("a"), H("a")), SHA).inputs, H("a"));
  assert.equal(resolveSha(reg(H("a"), H("b")), SHA).inputs, "", "backend and ops disagree");
  assert.equal(resolveSha(reg(H("a"), undefined), SHA).inputs, "", "ops unlabelled");
  assert.equal(resolveSha(reg(undefined, undefined), SHA).inputs, "");
});

test("deploy records the inputs, and a deploy with production's inputs still deploys (production never skips)", async () => {
  const deps = fakeDeps({ released: withInputs(false, H("a")) });
  const record = await production(deps, "deploy", { ...target, backend: D("7"), ops: D("8"), inputs: H("a") });
  assert.ok(ops(deps).includes("ecs update-service"), "rolled out");
  assert.equal(record.inputs, H("a"));
  assert.equal(record.previous.inputs, H("a"), "previous keeps its own inputs");
  assert.equal(JSON.parse(deps.params.get("/satis/deploy/prod/released")).inputs, H("a"));
});

test("a deploy without valid inputs records none, so the next automatic run cannot skip on it", async () => {
  for (const inputs of [undefined, "", "zz", H("A")]) {
    const record = await production(fakeDeps({ released: withInputs(false, H("a")) }), "deploy", { ...target, inputs });
    assert.equal("inputs" in record, false, String(inputs));
  }
});

test("redeploy keeps the released inputs (the same images); it never skips", async () => {
  const deps = fakeDeps({ released: withInputs(true, H("a"), H("b")) });
  const record = await production(deps, "redeploy");
  assert.ok(ops(deps).includes("ecs update-service"));
  assert.equal(record.inputs, H("a"));
  assert.equal(record.previous.inputs, H("b"));
});

test("rollback records the inputs of the release it goes back to, never the newer one's", async () => {
  // To released.previous: its own inputs, or none.
  let deps = fakeDeps({ released: withInputs(true, H("a"), H("b")), serviceTd: ARN(12) });
  let record = await production(deps, "rollback");
  assert.ok(ops(deps).includes("ecs update-service"), "never skips");
  assert.equal(record.sha, OLD_SHA);
  assert.equal(record.inputs, H("b"));
  deps = fakeDeps({ released: withInputs(true, H("a")), serviceTd: ARN(12) });
  record = await production(deps, "rollback");
  assert.equal("inputs" in record, false, "a previous release without inputs stays without");
  // To a given sha: that sha's resolved inputs.
  record = await production(fakeDeps({ released: withInputs(true, H("a")) }), "rollback", { sha: OLD_SHA, backend: D("5"), ops: D("6"), inputs: H("c") });
  assert.equal(record.inputs, H("c"));
  record = await production(fakeDeps({ released: withInputs(true, H("a")) }), "rollback", { sha: OLD_SHA, backend: D("5"), ops: D("6") });
  assert.equal("inputs" in record, false);
});

test("nextReleased keeps only valid inputs, and only with the release they belong to", () => {
  const r1 = nextReleased(null, { sha: "1", backend: "b", ops: "o", taskDefinition: "t", inputs: H("a") });
  assert.equal(r1.inputs, H("a"));
  const r2 = nextReleased(r1, { sha: "2", backend: "b2", ops: "o2", taskDefinition: "t2" });
  assert.equal("inputs" in r2, false, "the new release without a hash does not inherit the old one's");
  assert.equal(r2.previous.inputs, H("a"));
  assert.equal("inputs" in nextReleased(null, { sha: "1", backend: "b", ops: "o", taskDefinition: "t", inputs: "bad" }), false);
});
