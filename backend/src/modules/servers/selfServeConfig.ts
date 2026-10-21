import { ConfigError } from "../../platform/errors.js";

/**
 * ADR-0046 sections 2 and 3: the self-serve kill switch and the caps. Environment settings only, validated at startup
 * (a bad value stops the backend, naming the variable, never the value). Only the operator changes them, by
 * configuration and a restart; there is deliberately no API for caps. Lowering a cap never deletes a server, it only
 * refuses new creates.
 */
export interface SelfServeConfig {
  /** `SELF_SERVE_ENABLED` (default false): off, POST /api/servers/agent answers 403 `forbidden`. */
  enabled: boolean;
  /** C1: live self-serve servers one account owns. */
  maxServersPerAccount: number;
  /** C2: live self-serve servers in total. */
  maxServersTotal: number;
  /** C3: self-serve servers one account owns that have never enrolled. */
  maxPendingPerAccount: number;
  /** C5: self-serve creations per account in any 24 hours, counted from the server rows (#526: survives a restart). */
  createsPerDay: number;
  /** C4: hours a self-serve server may stay never-enrolled before the pending sweep removes it. */
  pendingTtlHours: number;
}

interface Bound {
  name: string;
  fallback: number;
  min: number;
  max: number;
}

const BOUNDS = {
  maxServersPerAccount: { name: "SELF_SERVE_MAX_SERVERS_PER_ACCOUNT", fallback: 2, min: 1, max: 20 },
  maxServersTotal: { name: "SELF_SERVE_MAX_SERVERS_TOTAL", fallback: 25, min: 1, max: 1000 },
  maxPendingPerAccount: { name: "SELF_SERVE_MAX_PENDING_PER_ACCOUNT", fallback: 1, min: 1, max: 20 },
  createsPerDay: { name: "SELF_SERVE_CREATES_PER_DAY", fallback: 5, min: 1, max: 100 },
  // A week at most: longer only stockpiles empty servers (C3 bounds them per account, C2 in total).
  pendingTtlHours: { name: "SELF_SERVE_PENDING_TTL_HOURS", fallback: 24, min: 1, max: 168 },
} as const satisfies Record<string, Bound>;

export const DEFAULT_SELF_SERVE_CONFIG: SelfServeConfig = {
  enabled: false,
  maxServersPerAccount: BOUNDS.maxServersPerAccount.fallback,
  maxServersTotal: BOUNDS.maxServersTotal.fallback,
  maxPendingPerAccount: BOUNDS.maxPendingPerAccount.fallback,
  createsPerDay: BOUNDS.createsPerDay.fallback,
  pendingTtlHours: BOUNDS.pendingTtlHours.fallback,
};

function wholeNumber(env: NodeJS.ProcessEnv, bound: Bound): number {
  const raw = env[bound.name]?.trim() ?? "";
  if (raw === "") return bound.fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < bound.min || value > bound.max) {
    throw new ConfigError(`${bound.name} must be a whole number from ${bound.min} to ${bound.max} (default ${bound.fallback}).`);
  }
  return value;
}

export function loadSelfServeConfigFromEnv(env: NodeJS.ProcessEnv): SelfServeConfig {
  const rawEnabled = env.SELF_SERVE_ENABLED?.trim() ?? "";
  if (rawEnabled !== "" && rawEnabled !== "true" && rawEnabled !== "false") {
    throw new ConfigError('SELF_SERVE_ENABLED must be "true" or "false" (unset means false).');
  }
  const config: SelfServeConfig = {
    enabled: rawEnabled === "true",
    maxServersPerAccount: wholeNumber(env, BOUNDS.maxServersPerAccount),
    maxServersTotal: wholeNumber(env, BOUNDS.maxServersTotal),
    maxPendingPerAccount: wholeNumber(env, BOUNDS.maxPendingPerAccount),
    createsPerDay: wholeNumber(env, BOUNDS.createsPerDay),
    pendingTtlHours: wholeNumber(env, BOUNDS.pendingTtlHours),
  };
  if (config.maxPendingPerAccount > config.maxServersPerAccount) {
    throw new ConfigError("SELF_SERVE_MAX_PENDING_PER_ACCOUNT cannot be more than SELF_SERVE_MAX_SERVERS_PER_ACCOUNT.");
  }
  if (config.maxServersPerAccount > config.maxServersTotal) {
    throw new ConfigError("SELF_SERVE_MAX_SERVERS_PER_ACCOUNT cannot be more than SELF_SERVE_MAX_SERVERS_TOTAL.");
  }
  return config;
}
