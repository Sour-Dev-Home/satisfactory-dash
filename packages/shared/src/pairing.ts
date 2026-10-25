import { z } from "zod";
import { ServerIdSchema } from "./ids";
import { AGENT_INPUT_MAX_STRING, EnrollResponseSchema, EnrollmentCodeSchema } from "./agent";

/**
 * ADR-0051 section 1 and ADR-0057 Decisions 6 to 8: device-code pairing (RFC 8628 shape) and the version-policy block.
 * Contract only; no route serves these yet. Additive: no existing schema changes.
 *
 * FLOW. The agent asks for a pairing (`POST /agent/v1/pairings`, unauthenticated like enrol) and shows the `userCode` to
 * the owner. The owner types it into the dashboard (never a `?code=` link: nothing prefills it), sees who is asking
 * (`lookup`), and approves it (`approve`). Meanwhile the agent polls with its secret. One use: after `approved` has been
 * delivered the pairing is spent.
 *
 * SECRETS. `pairingSecret` is 128 random bits, base64url (22 characters). It travels ONLY in a request BODY (the poll's),
 * never in a URL, query string or header, so it cannot reach an access log. `userCode` is the SAME 60-bit
 * `XXXX-XXXX-XXXX` shape as an enrolment code (`EnrollmentCodeSchema`, unchanged), typed by a person, and is no secret
 * on its own: it only means something to a signed-in user who approves it.
 *
 * ERRORS reuse the shared envelope (`ApiErrorResponseSchema`) and existing codes, no new code: an unknown, spent or
 * expired `userCode` on lookup or approve is 404 `not_found` (all alike, so the answer is no oracle); a bad body is 400
 * `bad_request`; too many tries is 429 `rate_limited`; not signed in is 401 `unauthorized`. The poll NEVER answers
 * 404 for an unknown secret: an unknown or spent secret reads as `expired`. `approve` with an `existing` target the
 * caller may not manage is the same 404 `not_found` (never 403), so a server id is no ownership oracle.
 *
 * FOR THE ROUTES (not enforceable in a schema): rate-limit lookup and approve per user and per IP and lock out repeated
 * misses; spent and unknown codes must answer alike in body and timing; single use, 15-minute lifetime; the code is
 * typed upper case (the client upper-cases before sending, the schema does not normalise).
 */

/** 128 random bits as base64url without padding: 22 characters. */
export const PairingSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22}$/)
  .describe("A pairing's secret, base64url, 22 characters (128 bits). Request bodies only, never a URL.");

/** The pairing's lifetime and the agent's starting poll interval, seconds (ADR-0057). */
export const PAIRING_EXPIRES_IN_SECONDS = 900;
export const PAIRING_POLL_INTERVAL_SECONDS = 5;
/** RFC 8628 section 3.5: on `slow_down` the agent adds this many seconds to its interval, for the rest of the pairing. */
export const PAIRING_SLOW_DOWN_SECONDS = 5;

/** The poll's stable codes. The agent treats a code it does not know as `pending` and keeps polling. */
export const KNOWN_PAIRING_POLL_STATUSES = ["pending", "expired", "slow_down", "approved"] as const;

const IsoTimeSchema = z.iso.datetime({ offset: true });
/** Untrusted text shown on the approval screen: no control, format (bidi, zero-width) or line characters, so it cannot disguise itself. */
const PairingServerNameSchema = z
  .string()
  .min(1)
  .max(AGENT_INPUT_MAX_STRING)
  .regex(/^[^\p{C}\p{Zl}\p{Zp}]+$/u, "No control or invisible characters");

// ---------------------------------------------------------------------------------------------------------------------
// The agent API
// ---------------------------------------------------------------------------------------------------------------------

/** POST /agent/v1/pairings (unauthenticated). The name is the server's own label, bounded like every agent string. */
export const PairingStartRequestSchema = z.strictObject({
  agentVersion: z.string().min(1).max(32).regex(/^[0-9A-Za-z.+-]+$/).describe("The agent's own version, at most 32 characters"),
  serverName: PairingServerNameSchema.optional().describe("What the owner will see on the confirmation screen; at most 200 characters"),
});
/** 201. */
export const PairingStartResponseSchema = z.object({
  pairingSecret: PairingSecretSchema,
  userCode: EnrollmentCodeSchema.describe("Shown to the owner to type into the dashboard"),
  expiresIn: z.number().int().min(1).max(PAIRING_EXPIRES_IN_SECONDS).describe("Seconds until the pairing expires (900)"),
  interval: z.number().int().min(1).max(60).describe("Seconds between polls (5)"),
});

/** POST /agent/v1/pairings/poll. The secret is in the BODY, never the URL. */
export const PairingPollRequestSchema = z.strictObject({ pairingSecret: PairingSecretSchema });
/**
 * The poll's answer, discriminated by `status`. `approved` is answered 201 with EXACTLY enrol's shape (plus the
 * `status` tag), so the agent stores the credential the way it does after an enrolment; the others are 200.
 * `slow_down`: add PAIRING_SLOW_DOWN_SECONDS to the interval.
 */
export const PairingPollResponseSchema = z.discriminatedUnion("status", [
  // Strict: a credential or id riding on a non-approved status is a contract violation, never silently stripped.
  z.strictObject({ status: z.literal("pending") }),
  z.strictObject({ status: z.literal("expired") }),
  z.strictObject({ status: z.literal("slow_down") }),
  z.object({ status: z.literal("approved"), ...EnrollResponseSchema.shape }),
]);

// ---------------------------------------------------------------------------------------------------------------------
// The dashboard side (signed-in user)
// ---------------------------------------------------------------------------------------------------------------------

/** POST /api/pairings/lookup. */
export const PairingLookupRequestSchema = z.strictObject({ userCode: EnrollmentCodeSchema });
/** 200: what the confirmation screen shows. Unknown, spent or expired: 404 `not_found`. */
export const PairingLookupResponseSchema = z.object({
  serverName: PairingServerNameSchema.nullable().describe("The name the agent gave, or null when it gave none. Untrusted text: render as text"),
  agentVersion: z.string(),
  requestedAt: IsoTimeSchema,
});

/** POST /api/pairings/approve. `existing` re-pairs a server the caller owns (owner/admin); `new` creates one. */
export const PairingTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new") }),
  z.strictObject({ kind: z.literal("existing"), serverId: ServerIdSchema }),
]);
export const PairingApproveRequestSchema = z.strictObject({ userCode: EnrollmentCodeSchema, target: PairingTargetSchema });
/** 200. One use: a second approval is 404 `not_found`. */
export const PairingApproveResponseSchema = z.object({ serverId: ServerIdSchema });

// ---------------------------------------------------------------------------------------------------------------------
// The compat block (ADR-0057 Decisions 6 to 8): the version policy, additive only
// ---------------------------------------------------------------------------------------------------------------------

const VERSION = String.raw`\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?`;
/** A version: `MAJOR.MINOR.PATCH`, optionally `-prerelease`. */
export const CompatVersionSchema = z.string().regex(new RegExp(`^${VERSION}$`));
/**
 * A range: one or more sets joined by ` || `; a set is one or more comparators joined by spaces; a comparator is
 * `<`, `<=`, `>`, `>=` or `=` (or nothing, meaning `=`) followed by a version. Example: `>=1.0.0 <1.2.3 || =2.0.0`.
 */
export const CompatRangeSchema = z
  .string()
  .max(200)
  .regex(new RegExp(`^(?:[<>]=?|=)?${VERSION}(?: (?:[<>]=?|=)?${VERSION})*(?: \\|\\| (?:[<>]=?|=)?${VERSION}(?: (?:[<>]=?|=)?${VERSION})*)*$`));

export const CompatAdvisorySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  affected: CompatRangeSchema.describe("The versions this applies to"),
  fixed: CompatVersionSchema.describe("The first version that fixes it"),
  summary: z.string().max(500).describe("Plain text"),
});
export const CompatComponentSchema = z.object({
  current: CompatVersionSchema.describe("The newest release"),
  minSupported: CompatVersionSchema.describe("Older than this works but is unsupported"),
  minSafe: CompatVersionSchema.describe("Older than this has a known security problem"),
  advisories: z.array(CompatAdvisorySchema).max(100),
});
/** GET /api/compat (signed in): the dashboard compares each server's reported versions with this. */
export const CompatResponseSchema = z.object({ mod: CompatComponentSchema, agent: CompatComponentSchema });

export type PairingStartRequest = z.input<typeof PairingStartRequestSchema>;
export type PairingStartResponse = z.infer<typeof PairingStartResponseSchema>;
export type PairingPollResponse = z.infer<typeof PairingPollResponseSchema>;
export type PairingLookupResponse = z.infer<typeof PairingLookupResponseSchema>;
export type PairingApproveRequest = z.input<typeof PairingApproveRequestSchema>;
export type CompatResponse = z.infer<typeof CompatResponseSchema>;
