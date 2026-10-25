/** The agent's release number. Keep in step with package.json (a test checks). */
export const BASE_VERSION = "0.1.0";

/** Set by `scripts/build.mjs` (esbuild `define`): `<short git sha>.<build date as YYYYMMDD>`, or absent when git is unavailable. */
declare const __AGENT_BUILD__: string | undefined;

/** Joins the release and its build stamp: `0.1.0+abc1234.20261024`; a missing or malformed stamp leaves the plain release. */
export function composeVersion(base: string, build: string | undefined): string {
  return build && /^[0-9a-f]{4,12}\.\d{8}$/.test(build) ? `${base}+${build}` : base;
}

/** What the agent reports: its release plus the build it came from, so an old copy is recognisable (at most 32 characters). */
export const AGENT_VERSION = composeVersion(BASE_VERSION, typeof __AGENT_BUILD__ === "string" ? __AGENT_BUILD__ : undefined);

/** The build date (YYYY-MM-DD) in a reported version, or null when it has none. */
export function buildDateOf(version: string): string | null {
  const m = /\+[0-9a-f]{4,12}\.(\d{4})(\d{2})(\d{2})$/.exec(version);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
