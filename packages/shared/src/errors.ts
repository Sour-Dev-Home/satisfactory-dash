import { z } from "zod";

/**
 * ADR-0003 (plus ADR-0011's unauthorized/rate_limited, ADR-0012's not_editable and ADR-0025's
 * forbidden/service_unavailable).
 * The code -> HTTP status mapping deliberately lives only in the backend's error
 * middleware, not here, so there's exactly one mapping.
 */
export const KnownErrorCode = z.enum([
  "upstream_unreachable",
  "upstream_auth_rejected",
  "upstream_invalid_response",
  "upstream_error",
  "server_not_found",
  "not_found",
  "bad_request",
  "payload_too_large",
  "unsupported_media_type",
  "unauthorized",
  // ADR-0025 (additive): a signed-in user whose role on the server doesn't allow the action.
  // A non-member gets server_not_found, never this, so a server's existence isn't revealed.
  "forbidden",
  "not_editable",
  "rate_limited",
  // ADR-0025 (additive): a dependency the backend needs (the database) is down or slow.
  // Never used for a session lookup that fails because the database is down as 401: an outage
  // must not look like "signed out".
  "service_unavailable",
  // ADR-0030 (additive): managing servers. The host resolves to an address that is not loopback or
  // private (never names the address); the game server did not pass the connection test; the stored
  // tokens cannot be opened with this backend's key (re-enter them); the id is taken; the cap is reached.
  "address_not_allowed",
  "connection_test_failed",
  "connection_unreadable",
  "server_exists",
  "server_limit_reached",
  "internal",
]);
export type KnownErrorCode = z.infer<typeof KnownErrorCode>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    // z.string(), not KnownErrorCode: a code added later must not fail an
    // already-deployed frontend's parse (adding a code is non-breaking, ADR-0007).
    code: z.string().describe("A KnownErrorCode; clients must handle unknown codes generically"),
    message: z.string().describe("Safe to show a user"),
    requestId: z.string().describe("Matches the X-Request-Id header and server logs"),
    detail: z.string().optional().describe("Internal detail; only present in development/test"),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
