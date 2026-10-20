// ADR-0037 §3: the k6 side of a scenario (runs in k6 only: it imports the k6 modules). The timing and the guards are in
// plan.mjs and guards.mjs, which the Node tests cover; this file only sends what they decide.
import http from "k6/http";
import { sleep } from "k6";
import exec from "k6/execution";
import { openSeed, snapshotBody } from "./guards.mjs";
import { AGENT_TICK_SECONDS, SNAPSHOT_ROUTE, USER_ROUTES, USER_TICK_SECONDS, agentPartForTick, k6Options, scenarioPlan, userPath, userRequestsForTick } from "./plan.mjs";

const intEnv = (value, fallback) => (value === undefined || value === "" ? fallback : Number(value));

/**
 * Builds a scenario from the seed file's text (the entry script `open()`s it in the init context, so a refused seed
 * or target stops k6 before any request): `{ options, agent, user }` to export.
 */
export function createScenario(letter, seedText, env) {
  const { base, seed } = openSeed(seedText, env);
  const plan = scenarioPlan(letter, {
    agents: seed.agents.length,
    users: seed.users.length,
    smoke: env.SMOKE === "1",
    kneeStep: intEnv(env.KNEE_STEP, undefined),
    kneeStepSeconds: intEnv(env.KNEE_STEP_SECONDS, undefined),
  });

  /** This VU's identity: its group's offset plus its own number in the group (one iteration per VU). */
  const identity = (list) => {
    const entry = list[Number(__ENV.LOAD_OFFSET) + exec.scenario.iterationInTest];
    if (entry === undefined) exec.test.abort("A VU has no seeded identity; run the seed with more servers or users.");
    return entry;
  };
  const deadline = () => Date.now() + Number(__ENV.LOAD_DURATION) * 1000;
  const waitRest = (tickStarted, tickSeconds) => {
    const rest = tickSeconds - (Date.now() - tickStarted) / 1000;
    if (rest > 0) sleep(rest);
  };

  function agent() {
    const index = Number(__ENV.LOAD_OFFSET) + exec.scenario.iterationInTest;
    const { secret } = identity(seed.agents);
    const params = (part) => ({
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      tags: { name: SNAPSHOT_ROUTE, part, agent: String(index) },
    });
    const end = deadline();
    sleep(Math.random() * AGENT_TICK_SECONDS); // agents do not start in step
    for (let tick = 0; Date.now() < end; tick++) {
      const started = Date.now();
      const part = agentPartForTick(tick);
      http.post(`${base}/agent/v1/snapshots`, JSON.stringify(snapshotBody(seed.payloads, part, new Date().toISOString())), params(part));
      waitRest(started, AGENT_TICK_SECONDS);
    }
  }

  function user() {
    const { serverId, cookie } = identity(seed.users);
    const request = (key) => ["GET", `${base}${userPath(key, serverId)}`, null, { headers: { Cookie: `sd_session=${cookie}` }, tags: { name: `GET ${USER_ROUTES[key]}` } }];
    const end = deadline();
    sleep(Math.random() * USER_TICK_SECONDS);
    // A page load: the session and the server list once, then the Overview's polls. The browser sends a tick's
    // requests in parallel, so they go as one batch.
    http.batch([request("session"), request("servers")]);
    for (let tick = 0; Date.now() < end; tick++) {
      const started = Date.now();
      http.batch(userRequestsForTick(tick).map(request));
      waitRest(started, USER_TICK_SECONDS);
    }
  }

  return { options: k6Options(plan), agent, user };
}
