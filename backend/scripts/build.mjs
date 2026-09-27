// Issue #320, option C: bakes the commit that produced this bundle into it, so the running
// process can prove which build it is (platform/buildInfo.ts), without any public exposure or
// contract change. `git rev-parse HEAD` runs from this script's cwd (backend/, set by
// `npm run build -w backend`), which is inside the repo; if git itself is missing or this isn't a
// git checkout (e.g. a Docker build context without .git), the commit falls back to "unknown"
// rather than failing the build.
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

function resolveCommitAtBuildTime() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["pg-native"],
  outfile: "dist/server.cjs",
  // esbuild replaces the bare identifier BUILD_COMMIT with this string literal wherever it's
  // referenced (platform/buildInfo.ts); nowhere else (tests, an unbundled run) is it ever defined.
  define: { BUILD_COMMIT: JSON.stringify(resolveCommitAtBuildTime()) },
});
