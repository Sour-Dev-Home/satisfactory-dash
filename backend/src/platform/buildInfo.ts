/**
 * Issue #320, option C of the design note: proves which commit is actually serving after a deploy,
 * entirely locally — no public exposure, no contract change (the alternative, putting the commit
 * in the public /api/health/ready response, was rejected for exactly that reason).
 *
 * `scripts/build.mjs` bakes the real commit in at build time via esbuild's `--define`, which does
 * a textual replacement of the bare identifier `BUILD_COMMIT` wherever it's referenced — including
 * inside `typeof BUILD_COMMIT` below. Everywhere else this file is loaded (vitest, tsx, any run
 * that didn't go through that build), the identifier is never declared, and `typeof` on an
 * undeclared identifier is legal JS that returns "undefined" rather than throwing (unlike a direct
 * reference to it, which would), so the fallback below is safe without a bundler.
 */
declare const BUILD_COMMIT: string | undefined;

/** Exported so the fallback logic itself is unit-testable without needing an esbuild-defined global. */
export function resolveBuildCommit(raw: string | undefined): string {
  return typeof raw === "string" && raw.length > 0 ? raw : "unknown";
}

export const buildCommit: string = resolveBuildCommit(typeof BUILD_COMMIT === "string" ? BUILD_COMMIT : undefined);
