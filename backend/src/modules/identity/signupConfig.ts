import { ConfigError } from "../../platform/errors.js";

/**
 * The terms text a new account accepts (ADR-0046 question 6). It is the "Last updated" date of
 * `frontend/public/terms.html`; bump it with that page (and `TERMS_VERSION` in
 * `frontend/src/auth/googleSignIn.ts`) so a changed text is accepted again by new accounts.
 */
export const TERMS_VERSION = "2026-09-24";

export type SignupMode = "closed" | "open";

export interface SignupConfig {
  mode: SignupMode;
  /** C8 (ADR-0046): new accounts per rolling hour, process-wide. */
  maxPerHour: number;
}

export const DEFAULT_SIGNUP_MAX_PER_HOUR = 20;
const MAX_SIGNUP_PER_HOUR_LIMIT = 1000;

/**
 * ADR-0046 section 3. `SIGNUP_MODE` is `closed` (default: today's behaviour) or `open`; anything
 * else is a startup error. `SIGNUP_MAX_PER_HOUR` is the C8 cap (1 to 1000, default 20). Messages
 * name the variable, never the submitted value.
 */
export function loadSignupConfigFromEnv(env: NodeJS.ProcessEnv): SignupConfig {
  const rawMode = env.SIGNUP_MODE?.trim() ?? "";
  if (rawMode !== "" && rawMode !== "closed" && rawMode !== "open") {
    throw new ConfigError('SIGNUP_MODE must be "closed" or "open" (unset means closed).');
  }
  const rawMax = env.SIGNUP_MAX_PER_HOUR?.trim() ?? "";
  let maxPerHour = DEFAULT_SIGNUP_MAX_PER_HOUR;
  if (rawMax !== "") {
    maxPerHour = Number(rawMax);
    if (!/^\d+$/.test(rawMax) || maxPerHour < 1 || maxPerHour > MAX_SIGNUP_PER_HOUR_LIMIT) {
      throw new ConfigError(`SIGNUP_MAX_PER_HOUR must be a whole number from 1 to ${MAX_SIGNUP_PER_HOUR_LIMIT}.`);
    }
  }
  return { mode: rawMode === "open" ? "open" : "closed", maxPerHour };
}
