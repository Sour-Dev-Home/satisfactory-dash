// ADR-0037 scenario (a), baseline: 1 agent and 3 users for 10 minutes (SMOKE=1: 1 minute, the CI run).
//   k6 run --out json=load/results/a.json load/a-baseline.js
// Seed first (backend/scripts/load-seed.ts); see docs-vault/wiki/runbooks/load-testing.md.
import { createScenario } from "./lib/k6-run.mjs";

const scenario = createScenario("a", open(__ENV.LOAD_SEED || "./.data/seed.json"), __ENV);

export const options = scenario.options;
export const agent = scenario.agent;
export const user = scenario.user;
