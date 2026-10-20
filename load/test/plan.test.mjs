import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_TICK_SECONDS,
  USER_ROUTES,
  USER_TICK_SECONDS,
  agentPartForTick,
  k6Options,
  scenarioPlan,
  userPath,
  userRequestsForTick,
} from "../lib/plan.mjs";

test("agents push status and power every 5 s and the factory every 30 s", () => {
  assert.equal(AGENT_TICK_SECONDS, 5);
  const parts = Array.from({ length: 12 }, (_, tick) => agentPartForTick(tick));
  assert.deepEqual(parts, ["full", "partial", "partial", "partial", "partial", "partial", "full", "partial", "partial", "partial", "partial", "partial"]);
});

test("users poll as the frontend does: status, players and power every 10 s, factory 30 s, alerts 60 s", () => {
  assert.equal(USER_TICK_SECONDS, 10);
  const perMinute = Array.from({ length: 6 }, (_, tick) => userRequestsForTick(tick)).flat();
  const count = (key) => perMinute.filter((k) => k === key).length;
  assert.equal(count("status"), 6);
  assert.equal(count("players"), 6);
  assert.equal(count("power"), 6);
  assert.equal(count("factory"), 2);
  assert.equal(count("alertStatus"), 1);
  assert.deepEqual(userRequestsForTick(0), ["status", "players", "power", "factory", "alertStatus"]);
  assert.deepEqual(userRequestsForTick(1), ["status", "players", "power"]);
});

test("a user path is the route pattern with the server id filled in", () => {
  assert.equal(USER_ROUTES.status, "/api/servers/:serverId/status");
  assert.equal(userPath("status", "load-001"), "/api/servers/load-001/status");
  assert.equal(userPath("alertStatus", "load-002"), "/api/servers/load-002/alerts/status");
  assert.equal(userPath("servers", "load-001"), "/api/servers");
  assert.throws(() => userPath("nope", "load-001"), /route/);
  assert.throws(() => userPath("status", "../x"), /server id/);
});

const seeded = { agents: 40, users: 30 };

test("scenario (a) is 1 agent and 3 users for 10 minutes", () => {
  const plan = scenarioPlan("a", seeded);
  assert.equal(plan.name, "a-baseline");
  assert.equal(plan.totalSeconds, 600);
  assert.deepEqual(plan.agents, [{ name: "agents", offset: 0, vus: 1, startSeconds: 0, durationSeconds: 600 }]);
  assert.deepEqual(plan.users, { name: "users", offset: 0, vus: 3, startSeconds: 0, durationSeconds: 600 });
});

test("scenario (b) is 10 agents and 30 users for 30 minutes", () => {
  const plan = scenarioPlan("b", seeded);
  assert.equal(plan.name, "b-target");
  assert.equal(plan.totalSeconds, 1800);
  assert.equal(plan.agents.reduce((sum, group) => sum + group.vus, 0), 10);
  assert.equal(plan.users.vus, 30);
});

test("the smoke run shortens a scenario to about a minute", () => {
  const plan = scenarioPlan("a", { ...seeded, smoke: true });
  assert.equal(plan.totalSeconds, 60);
  assert.equal(plan.agents[0].durationSeconds, 60);
  assert.equal(plan.users.durationSeconds, 60);
});

test("scenario (c) adds agents in steps up to every seeded agent, each using its own identity", () => {
  const plan = scenarioPlan("c", { agents: 12, users: 3, kneeStep: 5, kneeStepSeconds: 120 });
  assert.equal(plan.name, "c-knee");
  assert.deepEqual(
    plan.agents.map(({ offset, vus, startSeconds, durationSeconds }) => [offset, vus, startSeconds, durationSeconds]),
    [
      [0, 5, 0, 360],
      [5, 5, 120, 240],
      [10, 2, 240, 120],
    ],
  );
  assert.equal(plan.totalSeconds, 360);
  assert.equal(plan.users.vus, 3);
});

test("a scenario needing more identities than were seeded is refused", () => {
  assert.throws(() => scenarioPlan("b", { agents: 9, users: 30 }), /--servers 10/);
  assert.throws(() => scenarioPlan("b", { agents: 10, users: 29 }), /--users 30/);
  assert.throws(() => scenarioPlan("c", { agents: 0, users: 3 }), /--servers/);
  assert.throws(() => scenarioPlan("d", seeded), /scenario/);
});

test("the knee step settings are validated", () => {
  assert.throws(() => scenarioPlan("c", { ...seeded, kneeStep: 0 }), /step/);
  assert.throws(() => scenarioPlan("c", { ...seeded, kneeStepSeconds: 5 }), /step/);
  assert.throws(() => scenarioPlan("c", { ...seeded, kneeStep: Number.NaN }), /step/);
});

test("k6 options run each group as one long iteration per VU, with report-only thresholds", () => {
  const options = k6Options(scenarioPlan("c", { agents: 12, users: 3, kneeStep: 5, kneeStepSeconds: 120 }));
  const step1 = options.scenarios.agents_step_1;
  assert.equal(step1.executor, "per-vu-iterations");
  assert.equal(step1.vus, 5);
  assert.equal(step1.iterations, 1);
  assert.equal(step1.startTime, "120s");
  assert.equal(step1.exec, "agent");
  assert.deepEqual(step1.env, { LOAD_OFFSET: "5", LOAD_DURATION: "240" });
  assert.ok(Number.parseInt(step1.maxDuration, 10) > 240);
  assert.equal(options.scenarios.users.exec, "user");
  // (c) stops itself once the snapshot p95 passes 1 s or errors pass 1%; (a) and (b) only record.
  const snapshot = options.thresholds["http_req_duration{name:POST /agent/v1/snapshots}"];
  assert.deepEqual(snapshot[0], { threshold: "p(95)<1000", abortOnFail: true, delayAbortEval: "1m" });
  const baseline = k6Options(scenarioPlan("a", seeded));
  assert.equal(baseline.thresholds["http_req_duration{name:POST /agent/v1/snapshots}"][0].abortOnFail, false);
  assert.deepEqual(baseline.summaryTrendStats, ["min", "med", "p(95)", "p(99)", "max", "count"]);
});
