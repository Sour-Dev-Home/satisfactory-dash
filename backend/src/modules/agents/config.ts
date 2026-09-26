import type { Cadence } from "@satisfactory-dash/shared";

/** ADR-0031 PR 5a: the cadence the backend asks every agent to sample at, and answers with in every snapshot response. */
export const AGENT_CADENCE: Cadence = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };

/** An enrolment code is valid this long and works once. */
export const ENROLLMENT_CODE_TTL_MS = 10 * 60 * 1000;

/** The most a snapshot body may be once decompressed (agents send gzip; a compression bomb is refused with 413). */
export const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;

/** An agent's `last_seen_at` is written at most this often per credential. */
export const LAST_SEEN_INTERVAL_MS = 30_000;
