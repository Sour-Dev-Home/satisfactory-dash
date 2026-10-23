// The production deploy (ADR-0049 D4 steps 1 and 3, D5), run by .github/workflows/deploy.yml:
//
//   node scripts/deploy/deploy.mjs resolve [<sha>]                         no AWS: the two digests for a sha on main
//   node scripts/deploy/deploy.mjs production <deploy|redeploy|rollback> [<sha> <backend digest> <ops digest>]
//
// `production` runs with the satis-prod-deploy role's credentials (OIDC). It reads the base task definitions Terraform
// published, copies each with the new image only, migrates first (deploy only), rolls the service out, watches the two
// backend alarms, checks /api/health/ready and writes the release record. Every external call goes through `deps`, so
// deploy.test.mjs drives the whole flow with fakes.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPOSITORIES,
  STAGING_CONTAINERS,
  alarming,
  checkBackendBase,
  checkMigrateBase,
  checkStagingBase,
  checkStagingNetwork,
  cloudflaredPin,
  digestFromInspect,
  imageRef,
  isDigest,
  isSha,
  nextReleased,
  noticeText,
  parseReleased,
  revisionFrom,
  revisionWith,
  rolloutStatus,
} from "./lib.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CONFIG = {
  environment: "prod",
  cluster: "satis-prod",
  service: "satis-prod",
  alarms: ["satis-prod-backend-critical", "satis-prod-backend-errors"],
  healthUrl: "https://api.satis-manager.com/api/health/ready",
  // Worst case (migrate 15 + rollout 12 + watch 10 + rollback 12 + health 3 = 52 minutes) stays inside the job's
  // 60 minutes and the role's 1-hour session.
  rolloutTimeoutMs: 12 * 60_000,
  migrateTimeoutMs: 15 * 60_000,
  // D5 step 4: the alarms' 5-minute periods can outlast ECS's own bake time, so CI watches for 10 minutes.
  watchMs: 10 * 60_000,
  pollMs: 15_000,
  healthTimeoutMs: 3 * 60_000,
};

const param = (env, name) => `/satis/deploy/${env}/${name}`;

/** The real calls: the AWS CLI (JSON out), docker buildx imagetools, git, fetch and the clock. */
export function realDeps() {
  const dir = mkdtempSync(path.join(tmpdir(), "deploy-"));
  let n = 0;
  return {
    aws(args, input) {
      const full = [...args];
      if (input !== undefined) {
        const file = path.join(dir, `in-${n++}.json`);
        writeFileSync(file, JSON.stringify(input));
        full.push("--cli-input-json", `file://${file}`);
      }
      const out = execFileSync("aws", [...full, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
      return out.trim() ? JSON.parse(out) : {};
    },
    inspect(ref) {
      const out = execFileSync("docker", ["buildx", "imagetools", "inspect", ref, "--format", "{{json .}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return JSON.parse(out);
    },
    recentShas(limit) {
      return execFileSync("git", ["log", "--format=%H", "-n", String(limit), "HEAD"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    },
    readFile: (p) => readFileSync(path.join(ROOT, p), "utf8"),
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: (s) => console.log(s),
    env: process.env,
  };
}

/** D4 step 1: both images for one sha, as digests, checked (arm64 present, revision label = sha). */
export function resolveSha(deps, sha) {
  if (!isSha(sha)) throw new Error(`not a full commit sha: ${sha}`);
  return {
    sha,
    backend: digestFromInspect(deps.inspect(`${REPOSITORIES.backend}:${sha}`), sha),
    ops: digestFromInspect(deps.inspect(`${REPOSITORIES.ops}:${sha}`), sha),
  };
}

/** No sha given: the newest commit on main whose images were published (a commit that changed no backend path has none). */
export function resolveNewest(deps, limit = 50) {
  for (const sha of deps.recentShas(limit)) {
    try {
      return resolveSha(deps, sha);
    } catch (e) {
      deps.log(`  ${sha.slice(0, 8)}: ${e.message.split("\n")[0]}`);
    }
  }
  throw new Error(`none of the last ${limit} commits has published images`);
}

const getParam = (deps, name) => deps.aws(["ssm", "get-parameter", "--name", name, "--query", "Parameter.Value"]);
const describeTd = (deps, arn) => deps.aws(["ecs", "describe-task-definition", "--task-definition", arn]).taskDefinition;
const register = (deps, input) => deps.aws(["ecs", "register-task-definition"], input).taskDefinition.taskDefinitionArn;
const describeService = (deps, c) => deps.aws(["ecs", "describe-services", "--cluster", c.cluster, "--services", c.service]).services[0];

function checkedBase(deps, c, which) {
  const arn = getParam(deps, param(c.environment, which === "backend" ? "backend-task-definition" : "migrate-task-definition"));
  const td = describeTd(deps, arn);
  const problems = which === "backend"
    ? checkBackendBase(td, { environment: c.environment, cloudflared: cloudflaredPin(deps.readFile("infra/aws/ecs.tf")) })
    : checkMigrateBase(td, { environment: c.environment });
  if (problems.length) throw new Error(`the ${which} base ${arn} is not what Terraform applied: ${problems.join("; ")}`);
  return td;
}

/** D5 step 2: run db-migrate on the new ops image, with the service's own network settings. Throws on a non-zero exit. */
async function migrate(deps, c, ops) {
  const base = checkedBase(deps, c, "migrate");
  const arn = register(deps, revisionFrom(base, "ops", imageRef("ops", ops)));
  deps.log(`migrate: registered ${arn}`);
  const net = describeService(deps, c).networkConfiguration;
  const run = deps.aws(["ecs", "run-task", "--cluster", c.cluster, "--launch-type", "FARGATE", "--task-definition", arn, "--network-configuration", JSON.stringify(net)]);
  const task = run.tasks?.[0];
  if (!task) throw new Error(`db-migrate did not start: ${JSON.stringify(run.failures ?? [])}`);
  const deadline = deps.now() + c.migrateTimeoutMs;
  for (;;) {
    const t = deps.aws(["ecs", "describe-tasks", "--cluster", c.cluster, "--tasks", task.taskArn]).tasks?.[0];
    if (t?.lastStatus === "STOPPED") {
      const exit = t.containers?.[0]?.exitCode;
      if (exit === 0) return deps.log("migrate: exit 0");
      printMigrateLog(deps, task.taskArn);
      throw new Error(`db-migrate exited ${exit ?? "without starting"} (${t.stoppedReason ?? "no reason"}); the service was not touched`);
    }
    if (deps.now() > deadline) throw new Error("db-migrate did not finish in time; the service was not touched");
    await deps.sleep(c.pollMs);
  }
}

function printMigrateLog(deps, taskArn) {
  try {
    const id = taskArn.split("/").pop();
    const events = deps.aws(["logs", "get-log-events", "--log-group-name", `/ecs/satis-${CONFIG.environment}/ops`, "--log-stream-name", `db-migrate/ops/${id}`, "--limit", "50"]).events ?? [];
    // This repository's Actions logs are public: never echo a connection string or the database host.
    const redact = (s) => String(s).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]").replace(/[\w.-]+\.rds\.amazonaws\.com/gi, "[rds host]");
    for (const e of events) deps.log(`  | ${redact(e.message)}`);
  } catch (e) {
    deps.log(`  (no migrate log: ${e.message.split("\n")[0]})`);
  }
}

/** D5 step 3: update the service and wait for our revision to complete. Returns the revision that ran before. */
async function rollOut(deps, c, taskDefinition) {
  const previous = describeService(deps, c).taskDefinition;
  deps.aws(["ecs", "update-service", "--cluster", c.cluster, "--service", c.service, "--task-definition", taskDefinition]);
  deps.log(`rollout: ${previous} -> ${taskDefinition}`);
  await waitRollout(deps, c, taskDefinition);
  return previous;
}

async function waitRollout(deps, c, taskDefinition) {
  const start = deps.now();
  const deadline = start + c.rolloutTimeoutMs;
  for (;;) {
    const s = rolloutStatus(describeService(deps, c), taskDefinition);
    if (s.state === "done") return deps.log("rollout: COMPLETED");
    // Right after update-service, DescribeServices may not list the new deployment yet: give it a minute.
    const notListedYet = s.state === "failed" && s.gone && deps.now() - start < 60_000;
    if (s.state === "failed" && !notListedYet) throw new Error(`rollout failed: ${s.reason}`);
    if (deps.now() > deadline) throw new Error(`rollout did not complete in time (${s.reason})`);
    await deps.sleep(c.pollMs);
  }
}

const alarmsNow = (deps, c) => alarming(deps.aws(["cloudwatch", "describe-alarms", "--alarm-names", ...c.alarms]));

async function healthy(deps, c) {
  const deadline = deps.now() + c.healthTimeoutMs;
  for (;;) {
    try {
      const r = await deps.fetch(c.healthUrl, { signal: AbortSignal.timeout(10_000) });
      if (r.status === 200) return true;
    } catch {
      // the tunnel may still be reconnecting
    }
    if (deps.now() > deadline) return false;
    await deps.sleep(c.pollMs);
  }
}

async function notify(deps, n) {
  const url = deps.env.DEPLOY_DISCORD_WEBHOOK;
  const text = noticeText({ ...n, runUrl: runUrl(deps.env) });
  deps.log(`notice:\n${text}`);
  if (!url) return deps.log("notice: no DEPLOY_DISCORD_WEBHOOK, not sent");
  try {
    const r = await deps.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) deps.log(`notice: Discord answered ${r.status}`);
  } catch (e) {
    deps.log(`notice: not sent (${e.message})`);
  }
}

const runUrl = (env) => (env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined);

/**
 * D5: deploy (migrate, roll out, watch, check, record), redeploy (the released digests on the current base, no
 * migration) or rollback (released.previous or a given sha's digests, no migration, no alarm pre-check).
 */
export async function production(deps, action, given = {}, c = CONFIG) {
  if (!["deploy", "redeploy", "rollback"].includes(action)) throw new Error(`unknown action: ${action}`);
  const released = parseReleased(getParam(deps, param(c.environment, "released")));
  let target;
  if (action === "deploy") {
    if (!isSha(given.sha) || !isDigest(given.backend) || !isDigest(given.ops)) throw new Error("deploy needs the resolved sha and both digests");
    target = given;
  } else if (action === "redeploy") {
    if (!released) throw new Error("nothing released yet to redeploy");
    target = { sha: released.sha, backend: released.backend, ops: released.ops };
  } else if (isSha(given.sha)) {
    if (!isDigest(given.backend) || !isDigest(given.ops)) throw new Error("rollback to a sha needs its resolved digests");
    target = given;
  } else {
    // Back to the last good release. When production isn't running the recorded release (a deploy whose health check
    // failed, or a manual rollout), that recorded one is the last good; otherwise it's the one before (security review).
    const running = describeService(deps, c).taskDefinition;
    if (released && running !== released.taskDefinition) {
      deps.log(`rollback: the service runs ${running}, not the recorded release; going back to the recorded release`);
      target = { sha: released.sha, backend: released.backend, ops: released.ops };
    } else {
      if (!released?.previous) throw new Error("no previous release to roll back to; give a sha");
      target = { sha: released.previous.sha, backend: released.previous.backend, ops: released.previous.ops };
    }
  }
  deps.log(`${action}: ${target.sha} backend ${target.backend} ops ${target.ops}`);

  try {
    // D5 step 1: ECS ignores a deployment alarm already in ALARM when the deployment starts. Rollback skips this.
    if (action !== "rollback") {
      const firing = alarmsNow(deps, c);
      if (firing.length) throw new Error(`alarms already in ALARM: ${firing.join(", ")}; fix or roll back first`);
    }
    const base = checkedBase(deps, c, "backend");
    if (action === "deploy") await migrate(deps, c, target.ops);
    const taskDefinition = register(deps, revisionFrom(base, "backend", imageRef("backend", target.backend)));
    deps.log(`backend: registered ${taskDefinition}`);
    const before = await rollOut(deps, c, taskDefinition);

    // D5 step 4: watch both alarms; either one in ALARM rolls back to what ran before. Not after a rollback: it usually
    // runs because an alarm fired, and that alarm's 5-minute period would still read ALARM, so the watch would undo the
    // rollback (security review). ECS's own alarm rollback still covers it.
    const until = action === "rollback" ? deps.now() : deps.now() + c.watchMs;
    let errors = 0;
    while (deps.now() < until) {
      let firing;
      try {
        firing = alarmsNow(deps, c);
        errors = 0;
      } catch (e) {
        // One flaky call shouldn't fail a good release; three in a row means we can't watch, so stop.
        if (++errors >= 3) throw new Error(`could not read the alarms during the watch: ${e.message.split("\n")[0]}; the new revision is running`);
        await deps.sleep(c.pollMs);
        continue;
      }
      if (firing.length) {
        deps.log(`watch: ${firing.join(", ")} in ALARM; rolling back to ${before}`);
        deps.aws(["ecs", "update-service", "--cluster", c.cluster, "--service", c.service, "--task-definition", before]);
        await waitRollout(deps, c, before);
        await notify(deps, { outcome: "rolled back", action, ...target, detail: `${firing.join(", ")} went to ALARM after the rollout` });
        throw new Error(`rolled back: ${firing.join(", ")} in ALARM`);
      }
      await deps.sleep(c.pollMs);
    }
    deps.log("watch: both alarms stayed OK");

    // D5 step 5.
    if (!(await healthy(deps, c))) throw new Error(`${c.healthUrl} did not answer 200; the new revision is running, check it`);

    // D5 step 6.
    // A redeploy re-runs the same release, so what it replaces is not a previous release: keep the one it had.
    const record = nextReleased(action === "redeploy" ? released.previous : released, { sha: target.sha, backend: target.backend, ops: target.ops, taskDefinition });
    deps.aws(["ssm", "put-parameter", "--name", param(c.environment, "released"), "--type", "String", "--overwrite", "--value", JSON.stringify(record)]);
    deps.log("released: recorded");
    await notify(deps, { outcome: "released", action, ...target });
    return record;
  } catch (e) {
    if (!/^rolled back:/.test(e.message)) await notify(deps, { outcome: "failed", action, ...target, detail: e.message });
    throw e;
  }
}

export const STAGING = {
  cluster: "satis-staging",
  logGroup: "/ecs/satis-staging",
  url: "https://api-staging.satis-manager.com",
  user: "staging-admin",
  // Postgres, db:init, two migration runs and the backend's own start, then the tunnel: a few minutes at most.
  upTimeoutMs: 8 * 60_000,
  stopTimeoutMs: 3 * 60_000,
  pollMs: 10_000,
};

const redact = (s) => String(s).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]").replace(/[\w.-]+\.rds\.amazonaws\.com/gi, "[rds host]");

/**
 * D4 step 2: run this release on staging and check it. The task is the staging base with three images swapped: this
 * release's backend, this release's ops (db-setup) and the released ops (db-previous: the schema production has now,
 * then this release's migrations on top). Then, through Access: /api/health and /ready answer 200, the staging admin
 * signs in, reads the session and the (empty) server list; and both setup containers exited 0. The task is always
 * stopped, and every container's exit code printed; on failure, the log tails too.
 */
export async function staging(deps, target, s = STAGING) {
  if (!isSha(target.sha) || !isDigest(target.backend) || !isDigest(target.ops)) throw new Error("staging needs the resolved sha and both digests");
  const { STAGING_ADMIN_PASSWORD: password, CF_ACCESS_CLIENT_ID: accessId, CF_ACCESS_CLIENT_SECRET: accessSecret } = deps.env;
  if (!password || !accessId || !accessSecret) throw new Error("STAGING_ADMIN_PASSWORD, CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set");

  const released = parseReleased(getParam(deps, param("prod", "released")));
  const previousOps = released?.ops ?? target.ops;
  deps.log(`staging: ${target.sha} on top of ${released ? `the released ops ${previousOps}` : "a fresh database (nothing released yet)"}`);

  const baseArn = getParam(deps, param("staging", "task-definition"));
  const base = describeTd(deps, baseArn);
  const problems = checkStagingBase(base, { cloudflared: cloudflaredPin(deps.readFile("infra/aws/ecs.tf")) });
  if (problems.length) throw new Error(`the staging base ${baseArn} is not what Terraform applied: ${problems.join("; ")}`);
  // Only the published network, checked: never one passed in (the staging role can't be limited to it, PR 4 review).
  const net = checkStagingNetwork(JSON.parse(getParam(deps, param("staging", "network"))));

  const taskDefinition = register(deps, revisionWith(base, {
    backend: imageRef("backend", target.backend),
    "db-setup": imageRef("ops", target.ops),
    "db-previous": imageRef("ops", previousOps),
  }));
  deps.log(`staging: registered ${taskDefinition}`);
  const run = deps.aws(["ecs", "run-task", "--cluster", s.cluster, "--launch-type", "FARGATE", "--task-definition", taskDefinition, "--network-configuration", JSON.stringify(net)]);
  const taskArn = run.tasks?.[0]?.taskArn;
  if (!taskArn) throw new Error(`the staging task did not start: ${JSON.stringify(run.failures ?? [])}`);
  deps.log(`staging: started ${taskArn}`);

  const access = { "CF-Access-Client-Id": accessId, "CF-Access-Client-Secret": accessSecret };
  const describe = () => deps.aws(["ecs", "describe-tasks", "--cluster", s.cluster, "--tasks", taskArn]).tasks?.[0];
  let ok = false;
  try {
    // Up: /api/health answers 200 through the tunnel, while the task is still running.
    const deadline = deps.now() + s.upTimeoutMs;
    for (;;) {
      const t = describe();
      if (t?.lastStatus === "STOPPED") throw new Error(`the staging task stopped before it answered (${t.stoppedReason ?? "no reason"})`);
      const r = await get(deps, `${s.url}/api/health`, access);
      if (r?.status === 200) break;
      if (deps.now() > deadline) throw new Error(`staging did not answer /api/health within ${s.upTimeoutMs / 60_000} minutes (last: ${r?.status ?? "no answer"})`);
      await deps.sleep(s.pollMs);
    }
    const ready = await get(deps, `${s.url}/api/health/ready`, access);
    if (ready?.status !== 200) throw new Error(`/api/health/ready answered ${ready?.status ?? "nothing"}`);

    // The migrations: the backend starting proves the schema is current (it refuses one behind its build); both setup
    // containers must also have exited 0.
    const setup = Object.fromEntries((describe()?.containers ?? []).map((c) => [c.name, c.exitCode]));
    for (const name of ["db-previous", "db-setup"]) if (setup[name] !== 0) throw new Error(`${name} exited ${setup[name] ?? "without finishing"}`);

    // Sign in as the staging admin, read the session and the server list (a fresh database has none).
    const login = await deps.fetch(`${s.url}/api/auth/login`, {
      method: "POST",
      headers: { ...access, "content-type": "application/json" },
      body: JSON.stringify({ username: s.user, password }),
      signal: AbortSignal.timeout(15_000),
    });
    if (login.status !== 200) throw new Error(`sign-in answered ${login.status}`);
    const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    if (!cookie) throw new Error("sign-in set no session cookie");
    const session = await getJson(deps, `${s.url}/api/auth/session`, { ...access, cookie });
    if (session?.authenticated !== true) throw new Error("the session does not read as signed in");
    const servers = await getJson(deps, `${s.url}/api/servers`, { ...access, cookie });
    if (!Array.isArray(servers?.servers) || servers.servers.length !== 0) throw new Error(`the server list is not empty (${JSON.stringify(servers).slice(0, 120)})`);
    deps.log("staging: health, ready, migrations, sign-in, session and server list all good");
    ok = true;
  } finally {
    await stopStaging(deps, s, taskArn, ok);
  }
  return { taskDefinition };
}

async function get(deps, url, headers) {
  try {
    return await deps.fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }
}

async function getJson(deps, url, headers) {
  const r = await get(deps, url, headers);
  if (r?.status !== 200) throw new Error(`${new URL(url).pathname} answered ${r?.status ?? "nothing"}`);
  return r.json();
}

async function stopStaging(deps, s, taskArn, ok) {
  try {
    deps.aws(["ecs", "stop-task", "--cluster", s.cluster, "--task", taskArn, "--reason", "staging check done"]);
  } catch (e) {
    deps.log(`staging: stop-task failed (${e.message.split("\n")[0]}); the task stops on its own when ECS gives up, check it`);
  }
  const deadline = deps.now() + s.stopTimeoutMs;
  let t;
  for (;;) {
    t = deps.aws(["ecs", "describe-tasks", "--cluster", s.cluster, "--tasks", taskArn]).tasks?.[0];
    if (t?.lastStatus === "STOPPED" || deps.now() > deadline) break;
    await deps.sleep(s.pollMs);
  }
  for (const c of t?.containers ?? []) deps.log(`staging: ${c.name} exit ${c.exitCode ?? "-"}${c.reason ? ` (${c.reason})` : ""}`);
  if (ok) return;
  const id = taskArn.split("/").pop();
  for (const name of STAGING_CONTAINERS) {
    try {
      const events = deps.aws(["logs", "filter-log-events", "--log-group-name", s.logGroup, "--log-stream-names", `${name}/${name}/${id}`, "--limit", "40"]).events ?? [];
      if (events.length) deps.log(`staging: ${name} log:`);
      for (const e of events) deps.log(`  | ${redact(e.message)}`);
    } catch {
      // no stream: the container never started
    }
  }
}

/** For the automatic run: a sha whose image run published nothing (no backend change) is a green skip, not a failure. */
export function resolveAuto(deps, sha) {
  try {
    return { ...resolveSha(deps, sha), skip: "false" };
  } catch (e) {
    if (!isSha(sha)) throw e;
    deps.log(`resolve: no published images for ${sha.slice(0, 8)} (${e.message.split("\n")[0]}); nothing to deploy`);
    return { sha, backend: "", ops: "", skip: "true" };
  }
}

function output(env, pairs) {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join("\n");
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${lines}\n`);
  console.log(lines);
}

async function main(argv) {
  const deps = realDeps();
  const [cmd, ...rest] = argv;
  if (cmd === "resolve") {
    const r = rest[0] ? resolveSha(deps, rest[0]) : resolveNewest(deps);
    output(deps.env, { ...r, skip: "false" });
  } else if (cmd === "resolve-auto") {
    output(deps.env, resolveAuto(deps, rest[0]));
  } else if (cmd === "staging") {
    const [sha, backend, ops] = rest;
    await staging(deps, { sha, backend, ops });
  } else if (cmd === "production") {
    const [action, sha, backend, ops] = rest;
    await production(deps, action, { sha: sha || undefined, backend: backend || undefined, ops: ops || undefined });
  } else {
    throw new Error("usage: deploy.mjs resolve [<sha>] | production <deploy|redeploy|rollback> [<sha> <backend> <ops>]");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
