// ADR-0037 scenario (b), target: 10 agents and 30 users for 30 minutes, a plausible group of friends.
//   k6 run --out json=load/results/b.json load/b-target.js
// Seed first with --servers 10 --users 30; see docs-vault/wiki/runbooks/load-testing.md.
import { createScenario } from "./lib/k6-run.mjs";

const scenario = createScenario("b", open(__ENV.LOAD_SEED || "./.data/seed.json"), __ENV);

export const options = scenario.options;
export const agent = scenario.agent;
export const user = scenario.user;
