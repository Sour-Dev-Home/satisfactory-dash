import { ConfigError } from "./errors.js";

/** A TCP port from an environment variable (PORT): a whole number from 1 to 65535, or the default when unset or empty. A
 *  non-numeric port used to become NaN (listen(NaN) picks a random port). Moved from the gameserver module's retired
 *  environment loader (ADR-0066); the message never echoes the value. */
export function parsePortEnv(name: string, raw: string | undefined, defaultValue: number): number {
  const text = raw?.trim();
  if (!text) {
    return defaultValue;
  }
  const value = /^\d{1,9}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ConfigError(`${name} must be a whole number from 1 to 65535 (or unset for ${defaultValue}).`);
  }
  return value;
}
