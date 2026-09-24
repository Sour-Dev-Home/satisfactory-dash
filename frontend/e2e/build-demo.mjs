// Builds the demo site (ADR-0026) for e2e/build-output.spec.ts, WITH the production API URL
// in the environment, as a real production CI build has it. The spec then checks that the
// URL is nowhere in the demo bundle: proof that the network transport (the only code that
// reads VITE_API_URL) never reaches the demo, not just that the variable happened to be empty.
import { execSync } from "node:child_process";

execSync("npx vite build --mode demo", {
  stdio: "inherit",
  env: { ...process.env, VITE_API_URL: "https://api.satis-manager.com" },
});
