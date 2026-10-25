// Bundles the agent into dist/agent.cjs and stamps the build into AGENT_VERSION (`0.1.0+<sha>.<date>`),
// so a copy built from old source is recognisable in Settings -> Agent. Without git it stays plain `0.1.0`.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `<short sha>.<YYYYMMDD>` (UTC) of the checkout, or null when git or a commit is unavailable. */
export function buildStamp(now = new Date()) {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!/^[0-9a-f]{4,12}$/.test(sha)) return null;
    return `${sha}.${now.toISOString().slice(0, 10).replaceAll("-", "")}`;
  } catch {
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stamp = buildStamp();
  await build({
    entryPoints: [resolve(root, "src/main.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: resolve(root, "dist/agent.cjs"),
    define: stamp ? { __AGENT_BUILD__: JSON.stringify(stamp) } : {},
    logLevel: "info",
  });
  console.log(`agent build stamp: ${stamp ?? "none (git unavailable)"}`);
}
