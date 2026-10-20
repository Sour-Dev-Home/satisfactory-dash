// ADR-0037 §3: what the load identities do and when. Plain JavaScript with no imports, shared by the k6 scenarios and
// their Node tests.
//
// Cadence: an agent pushes a snapshot every 5 s (status and power), every sixth one also carrying the factory (30 s),
// the defaults the backend hands an agent (`cadence` in the fixtures). A user polls as the frontend's Overview does
// (frontend/src/api/queries.ts POLL_MS): status, players and power every 10 s, factory every 30 s, the alert badge
// every 60 s, after loading the session and the server list once.

export const AGENT_TICK_SECONDS = 5;
const FACTORY_EVERY_AGENT_TICKS = 6;
export const USER_TICK_SECONDS = 10;
const FACTORY_EVERY_USER_TICKS = 3;
const ALERTS_EVERY_USER_TICKS = 6;

export const SNAPSHOT_ROUTE = "POST /agent/v1/snapshots";

/** The routes a user reads, as the shared `endpoints` patterns (also the `name` tag on each request). */
export const USER_ROUTES = Object.freeze({
  session: "/api/auth/session",
  servers: "/api/servers",
  status: "/api/servers/:serverId/status",
  players: "/api/servers/:serverId/players",
  power: "/api/servers/:serverId/power",
  factory: "/api/servers/:serverId/factory",
  alertStatus: "/api/servers/:serverId/alerts/status",
});

/** "full" (status, power, factory, players) on the first tick and every sixth after it, else "partial". */
export function agentPartForTick(tick) {
  return tick % FACTORY_EVERY_AGENT_TICKS === 0 ? "full" : "partial";
}

/** The USER_ROUTES keys a user reads on this 10 s tick. */
export function userRequestsForTick(tick) {
  const due = ["status", "players", "power"];
  if (tick % FACTORY_EVERY_USER_TICKS === 0) due.push("factory");
  if (tick % ALERTS_EVERY_USER_TICKS === 0) due.push("alertStatus");
  return due;
}

const SERVER_ID = /^[a-z0-9-]{1,32}$/;

export function userPath(key, serverId) {
  const route = Object.hasOwn(USER_ROUTES, key) ? USER_ROUTES[key] : undefined;
  if (route === undefined) throw new Error(`Unknown user route "${key}".`);
  if (!SERVER_ID.test(serverId)) throw new Error("Not a server id.");
  return route.replace(":serverId", serverId);
}

const SCENARIOS = {
  a: { name: "a-baseline", agents: 1, users: 3, seconds: 600 },
  b: { name: "b-target", agents: 10, users: 30, seconds: 1800 },
  c: { name: "c-knee", users: 3 },
};
const SMOKE_SECONDS = 60;
const DEFAULT_KNEE_STEP = 5;
const DEFAULT_KNEE_STEP_SECONDS = 120;

const group = (name, offset, vus, startSeconds, durationSeconds) => ({ name, offset, vus, startSeconds, durationSeconds });

/**
 * Which identities run when. `agents` and `users` are how many the seed made; a scenario that needs more is refused.
 * Each group takes its identities from `offset` on, so no two VUs share an agent credential or a session.
 *   (a) 1 agent, 3 users, 10 min.  (b) 10 agents, 30 users, 30 min.
 *   (c) `kneeStep` more agents every `kneeStepSeconds` until every seeded agent runs, with 3 users throughout.
 * `smoke` shortens (a) and (b) to 60 s, and (c) to 60 s steps of a third of a minute.
 */
export function scenarioPlan(letter, { agents, users, smoke = false, kneeStep = DEFAULT_KNEE_STEP, kneeStepSeconds = DEFAULT_KNEE_STEP_SECONDS }) {
  const scenario = Object.hasOwn(SCENARIOS, letter) ? SCENARIOS[letter] : undefined;
  if (scenario === undefined) throw new Error(`Unknown scenario "${letter}" (a, b or c).`);
  if (letter === "c") {
    if (!Number.isInteger(kneeStep) || kneeStep < 1 || !Number.isInteger(kneeStepSeconds) || kneeStepSeconds < 20) {
      throw new Error("The knee step must be at least 1 agent and 20 s.");
    }
    if (!(agents >= 1)) throw new Error("Scenario c needs seeded agents: run the seed with --servers N.");
    if (!(users >= scenario.users)) throw new Error(`Scenario c needs ${scenario.users} users: run the seed with --users ${scenario.users}.`);
    const stepSeconds = smoke ? 20 : kneeStepSeconds;
    const steps = Math.ceil(agents / kneeStep);
    const totalSeconds = smoke ? SMOKE_SECONDS : steps * stepSeconds;
    const groups = [];
    for (let step = 0; step < steps && step * stepSeconds < totalSeconds; step++) {
      const start = step * stepSeconds;
      groups.push(group(`agents_step_${step}`, step * kneeStep, Math.min(kneeStep, agents - step * kneeStep), start, totalSeconds - start));
    }
    return { name: scenario.name, totalSeconds, agents: groups, users: group("users", 0, scenario.users, 0, totalSeconds) };
  }
  if (!(agents >= scenario.agents)) throw new Error(`Scenario ${letter} needs ${scenario.agents} agents: run the seed with --servers ${scenario.agents}.`);
  if (!(users >= scenario.users)) throw new Error(`Scenario ${letter} needs ${scenario.users} users: run the seed with --users ${scenario.users}.`);
  const totalSeconds = smoke ? SMOKE_SECONDS : scenario.seconds;
  return {
    name: scenario.name,
    totalSeconds,
    agents: [group("agents", 0, scenario.agents, 0, totalSeconds)],
    users: group("users", 0, scenario.users, 0, totalSeconds),
  };
}

/** Room for the last request after a group's deadline, so k6 never cuts an iteration short. */
const GRACE_SECONDS = 30;

function k6Scenario(g, exec) {
  return {
    executor: "per-vu-iterations",
    exec,
    vus: g.vus,
    iterations: 1,
    startTime: `${g.startSeconds}s`,
    maxDuration: `${g.durationSeconds + GRACE_SECONDS}s`,
    gracefulStop: "0s",
    env: { LOAD_OFFSET: String(g.offset), LOAD_DURATION: String(g.durationSeconds) },
  };
}

/**
 * The k6 `options` for a plan. Each VU runs one iteration that loops at its cadence until its group's duration is up.
 * Thresholds are report-only (ADR-0037): k6 exits 99 when one is crossed and the runbook treats that as a finding,
 * not a failure. Only (c) aborts, which is how it stops once the knee is passed.
 */
export function k6Options(plan) {
  const knee = plan.name === "c-knee";
  const scenarios = {};
  for (const g of plan.agents) scenarios[g.name] = k6Scenario(g, "agent");
  scenarios[plan.users.name] = k6Scenario(plan.users, "user");
  const limit = (threshold) => ({ threshold, abortOnFail: knee, ...(knee ? { delayAbortEval: "1m" } : {}) });
  return {
    scenarios,
    thresholds: {
      [`http_req_duration{name:${SNAPSHOT_ROUTE}}`]: [limit("p(95)<1000")],
      http_req_failed: [limit("rate<0.01")],
    },
    summaryTrendStats: ["min", "med", "p(95)", "p(99)", "max", "count"],
  };
}
