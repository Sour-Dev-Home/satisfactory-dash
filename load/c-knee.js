// ADR-0037 scenario (c), knee: KNEE_STEP more agents (default 5) every KNEE_STEP_SECONDS (default 120) until every
// seeded agent runs, with 3 users throughout. k6 stops the run once the snapshot p95 passes 1 s or errors pass 1%;
// scripts/load-report.mjs finds the minute where that happened and how many agents were running.
//   k6 run --out json=load/results/c.json load/c-knee.js
// Seed first with as many servers as the ramp should reach; see docs-vault/wiki/runbooks/load-testing.md.
import { createScenario } from "./lib/k6-run.mjs";

const scenario = createScenario("c", open(__ENV.LOAD_SEED || "./.data/seed.json"), __ENV);

export const options = scenario.options;
export const agent = scenario.agent;
export const user = scenario.user;
