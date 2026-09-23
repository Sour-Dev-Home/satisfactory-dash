import { ConfigError } from "../../platform/errors.js";

/** ADR-0001: server ids are opaque, lowercase and URL-safe, never a host or port. Kept
 *  in step with packages/shared's ServerIdSchema (serverRegistry.test.ts asserts they
 *  agree). */
export const SERVER_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

export interface ServerRegistryEntry {
  id: string;
  /** Shown to users by GET /api/servers. Never a host or port. */
  displayName: string;
}

/**
 * ADR-0001: single-server mode is a registry of one. SATISFACTORY_SERVER_ID (default
 * "default") and SATISFACTORY_SERVER_NAME name it; every data route is scoped to that
 * id, so adding a second server later is a registry change, not a URL change. How to
 * reach each server (host, ports, tokens) is the gameserver module's config, which
 * server.ts pairs with each entry.
 */
export function loadServerRegistryFromEnv(env: NodeJS.ProcessEnv = process.env): ServerRegistryEntry[] {
  const id = env.SATISFACTORY_SERVER_ID?.trim() || "default";
  if (!SERVER_ID_PATTERN.test(id)) {
    throw new ConfigError(
      `SATISFACTORY_SERVER_ID "${id}" is invalid: use 1-32 characters of lowercase letters, digits and dashes.`,
    );
  }
  return [{ id, displayName: env.SATISFACTORY_SERVER_NAME?.trim() || "Satisfactory server" }];
}
