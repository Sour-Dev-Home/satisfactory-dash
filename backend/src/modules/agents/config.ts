import type { Cadence } from "@satisfactory-dash/shared";
import { ConfigError } from "../../platform/errors.js";

/** ADR-0031 PR 5a: the cadence the backend asks every agent to sample at, and answers with in every snapshot response. */
export const AGENT_CADENCE: Cadence = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };

/** An enrolment code is valid this long and works once. */
export const ENROLLMENT_CODE_TTL_MS = 10 * 60 * 1000;

/** Enrolment attempts per client network per minute. */
export const ENROLL_PER_NETWORK_PER_MINUTE = 10;

/**
 * Enrolment attempts per minute across every caller, for the whole process (ADR-0046 section 4, #524). It is high
 * because a low cap lets a botnet of about 120 networks (10 a minute each) lock real owners out for as long as it runs;
 * the code length is what makes the high cap safe.
 * Guess arithmetic: a code is 60 bits (12 base32 characters). One open code per server, so at most C2 + 8 = 33 open codes.
 * A year of guessing at the cap is 1,200 x 60 x 24 x 365 = 6.3e8 attempts, and the chance that one hits an open code is
 * 6.3e8 x 33 / 2^60 = about 1.8e-8. With the old 40-bit codes the same cap gave 6.3e8 x 33 / 2^40 = about 0.019.
 * Both figures assume one backend instance (ADR-0010): with N instances the cap, and the chance, multiply by N.
 * Requests refused by the per-network limit never count here (agentApi.ts), so a lockout really needs about 120 networks.
 */
export const ENROLL_GLOBAL_PER_MINUTE = 1200;

/**
 * The most a snapshot body may be once decompressed (agents send gzip; a compression bomb is refused with 413). Kept at
 * 5 MB (#514): a factory building serializes to about 440 bytes (the contract fixture, measured 2026-10-20) and the go-live
 * runbook quotes about 100 KB for a real factory read, so 5 MB is a factory of roughly 11,000 buildings. Lowering it would
 * refuse the largest real factories outright; the per-minute byte budget below is what bounds the parsing work.
 */
export const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * #514 (ADR-0045 M10): per-credential ingest budgets, as token buckets (platform/tokenBucket.ts). An agent sends one
 * snapshot per `statusSeconds` tick (5 s today; power and factory parts ride along when due) and queues up to 120 while
 * the backend is unreachable (agent/src/agentRunner.ts, QUEUE_MAX_SNAPSHOTS), which it sends back to back on recovery.
 */
const SNAPSHOT_INTERVAL_SECONDS = Math.min(AGENT_CADENCE.statusSeconds, AGENT_CADENCE.powerSeconds, AGENT_CADENCE.factorySeconds);
export const SNAPSHOT_RATE = {
  /** The whole 120-snapshot queue at once, plus room for the snapshots that arrive while it drains. */
  capacity: 150,
  /** Three times the cadence (one every 5 s is 0.2 a second): a little jitter or a retry never trips it. */
  refillPerSecond: 3 / SNAPSHOT_INTERVAL_SECONDS,
};

/** Decompressed snapshot bytes per credential. An admitted snapshot is charged its size after it is read, and a
 *  credential in debt is refused before its next body is read, so the parse work it can cause is bounded. */
export const SNAPSHOT_BYTE_BUDGET = {
  /** 32 MB: the 120-snapshot queue with 20 factory reads (every sixth tick) at 1 MB each, ten times the measured 100 KB. */
  capacity: 32 * 1024 * 1024,
  /** 4 MB a minute: a 1 MB factory read every 30 s plus status and power every 5 s, about 16 times a real agent's
   *  ~250 KB a minute. A factory bigger than that is slowed (a 5 MB read about every 75 s), never locked out. */
  refillPerSecond: (4 * 1024 * 1024) / 60,
};

/** GET /commands and POST /commands/:id/result per credential: the agent long-polls for up to 25 s and reports one result
 *  per command, a few a minute; 30 at once and one every 2 s steady is ten times that. */
export const COMMANDS_RATE = { capacity: 30, refillPerSecond: 0.5 };

/** Failed authentications (missing, malformed, unknown or revoked credential). Successful ones never count. */
export const AUTH_FAILURE_LIMITS = {
  /** Per client network (an IPv6 /64 is one) a minute: a misconfigured agent fails a few times and stops on 401. */
  perNetwork: { max: 60, windowMs: 60_000 },
  /** For the whole process a minute: a flood from many addresses costs at most this many database lookups. */
  global: { max: 6000, windowMs: 60_000 },
};

/** A credential that authenticated within this long skips the failure budgets (it is still looked up every time, so a
 *  revocation takes effect at once). An agent away longer than this during a flood waits for the flood to pass. */
export const RECENTLY_VALID_TTL_MS = 15 * 60_000;
/** Database lookups per remembered credential, across every agent route: 50 at once, then 10 a second. A real agent
 *  makes about one request every 5 s (snapshot) plus its long-poll, so this is only a backstop that stops a credential's
 *  owner from flooding the lookup query and filling the connection pool. */
export const KNOWN_CREDENTIAL_LOOKUPS = { capacity: 50, refillPerSecond: 10 };
/** The most credentials remembered as recently valid; the oldest is forgotten first. */
export const RECENTLY_VALID_MAX = 1_000;

/** An agent's `last_seen_at` is written at most this often per credential. */
export const LAST_SEEN_INTERVAL_MS = 30_000;

/** Enrolment codes one account may create per minute (each creation drops the server's previous code). */
export const ENROLLMENT_CODES_PER_MINUTE = 10;

/** ADR-0046 C7 (#527): the default for enrolment codes one account may create per hour. A setup needs 1 to 3 (a typo, the
 *  10-minute expiry), so 20 bounds enrolment churn and its audit rows. In memory, per backend instance, like the minute
 *  limit (ADR-0046 section 2 C7 and Consequences accept this). */
export const ENROLLMENT_CODES_PER_HOUR_DEFAULT = 20;

/** `ENROLLMENT_CODES_PER_HOUR`: a whole number from 1 to 1000, or unset for the default. Anything else is a ConfigError,
 *  so the backend refuses to start; the message never echoes the value. The operator's account is exempt from the limit. */
export function loadEnrollmentCodesPerHour(env: Record<string, string | undefined>): number {
  const text = env.ENROLLMENT_CODES_PER_HOUR?.trim();
  if (!text) return ENROLLMENT_CODES_PER_HOUR_DEFAULT;
  const value = /^\d{1,4}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new ConfigError(`ENROLLMENT_CODES_PER_HOUR must be a whole number from 1 to 1000 (or unset for ${ENROLLMENT_CODES_PER_HOUR_DEFAULT}).`);
  }
  return value;
}

/** ADR-0051 section 1 / ADR-0057 D6, device-code pairing. Starting a pairing is unauthenticated, so it is limited per client
 *  network (an IPv6 /64 counts as one) AND across the process: 6 an hour per network (a setup needs one to three), 600 an
 *  hour overall. The overall cap also bounds the open codes: 600 an hour x 15 minutes = at most 150 open at a time, so a
 *  60-bit code guess at the entry limits below has about 150 / 2^60 chance per try. In memory, per instance (ADR-0010). */
export const PAIRING_START_PER_NETWORK_PER_HOUR = 6;
export const PAIRING_START_GLOBAL_PER_HOUR = 600;
/** Polls per network per minute: a pairing polls every 5 s (12 a minute) and slow_down only lengthens that; this leaves room
 *  for several agents behind one address and only stops a flood. */
export const PAIRING_POLL_PER_NETWORK_PER_MINUTE = 120;
/** A poll sooner than the expected interval minus this grace (network jitter) is answered `slow_down`. */
export const PAIRING_POLL_GRACE_SECONDS = 1;
/** Code entry (lookup and approve share the budget, every try counts, hit or miss), per signed-in account, like C7: 10 a
 *  minute and 20 an hour; the operator is exempt from the hourly one. Plus per client network, so one address cannot spread
 *  tries over many accounts. */
export const PAIRING_ENTRY_PER_ACCOUNT_PER_MINUTE = 10;
export const PAIRING_ENTRY_PER_ACCOUNT_PER_HOUR = 20;
export const PAIRING_ENTRY_PER_NETWORK_PER_MINUTE = 30;

/**
 * ADR-0057 D6 to D8, GET /api/compat: the version policy the dashboard compares each server's reported versions with.
 * For now it is this constant (the versions this repo knows: the agent's package version; the mod has no release yet, so it
 * mirrors the agent's). Later it would be read from a table the operator edits, so a security advisory needs no deploy; the
 * response shape is the contract's and does not change.
 */
export const COMPAT_POLICY = {
  mod: { current: "0.1.0", minSupported: "0.1.0", minSafe: "0.1.0", advisories: [] },
  agent: { current: "0.1.0", minSupported: "0.1.0", minSafe: "0.1.0", advisories: [] },
};
