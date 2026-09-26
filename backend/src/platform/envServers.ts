/**
 * Servers configured in the ENVIRONMENT (SATISFACTORY_SERVERS_FILE, SATISFACTORY_* variables) versus servers stored in the
 * DATABASE (issue #196, architect ruling: option A).
 *
 * With a database the servers come ONLY from it (ADR-0030: the database is the single source of truth once
 * `npm run admin -- import-servers` has run). The environment is not a second source, so:
 *  - no runtime entry is built from it at boot (there is no placeholder whose pollers could fire without credentials, which
 *    was also the root of the #239 race);
 *  - with zero stored servers the backend serves none, and says so once, naming the variables (never their values);
 *  - the environment path stays for what needs it: `import-servers`, `captureFactory`, and NO-DATABASE mode (dev, the demo,
 *    the tests).
 * Environment-configured LAN servers are therefore not served in database mode; saved LAN servers wait for certificate
 * pinning (ADR-0030 amendment 1).
 */

/** The entries built from the environment: none when a database is in use, else whatever `build` makes. */
export function environmentServerEntries<T>(hasDatabase: boolean, build: () => T[]): T[] {
  return hasDatabase ? [] : build();
}

export const ENV_SERVERS_NOT_SERVED_MESSAGE =
  "servers configured in the environment are not served when a database is used; run npm run admin -- import-servers";

/** Warns ONCE, by variable NAME only, that environment-configured servers are ignored. Returns whether it warned. */
export function warnEnvServersNotServed(logger: { warn(fields: { ignored: string[] }, message: string): void }, envNames: readonly string[]): boolean {
  if (envNames.length === 0) return false;
  logger.warn({ ignored: [...envNames] }, ENV_SERVERS_NOT_SERVED_MESSAGE);
  return true;
}
