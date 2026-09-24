/**
 * When the Postgres test container can't start: skip the database tests locally with a loud
 * notice, but FAIL in CI (ADR-0025, architect's rule). Otherwise a runner change could silently
 * drop every DB test while the required check stays green.
 */
export interface HarnessEnv {
  CI?: string;
}

export async function startOrSkip<T>(
  start: () => Promise<T>,
  env: HarnessEnv,
  notice: (message: string) => void,
): Promise<T | null> {
  try {
    return await start();
  } catch (err) {
    const reason = err instanceof Error ? err.message.split("\n")[0] : "unknown error";
    if (env.CI) {
      throw new Error(
        `The Postgres test container could not start, and CI is set, so the database tests must not be skipped: ${reason}`,
      );
    }
    notice(
      `*** DATABASE TESTS SKIPPED: no Docker container runtime reachable (${reason}). ` +
        "Start Docker Desktop to run them; CI always runs them. ***",
    );
    return null;
  }
}
