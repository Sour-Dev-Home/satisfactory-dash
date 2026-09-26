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
  // ADR-0030 (additive): servers are still configured in the environment and none is stored yet, so adding
  // one would make the database win at the next restart and drop them. Run the import first.
  "import_required",
  // ADR-0030 amendment 1 (additive): a LAN (private, non-loopback) address; LAN servers wait for certificate pinning.
  "lan_requires_cert_pinning",
  // ADR-0027 PR 7 (additive): alerts. The rule does not exist on this server (404); `item` cannot be changed on a
  // rule (422); a preset can be disabled and tuned but not deleted (409); the kind cannot be created through the API
  // (422); no Discord destination is configured (404); the webhook URL was refused (422, with a `reason`, and the
  // message NEVER echoes the URL); delivery is switched off, so nothing can be sent (409); the mute time is not
  // in the future or is more than 7 days ahead (422).
  "rule_not_found",
  "rule_item_immutable",
  "preset_disable_only",
  "rule_kind_not_creatable",
  "destination_not_configured",
  "webhook_invalid",
  "delivery_off",
  "mute_invalid",
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
    // ADR-0027 PR 7 (additive, optional): a stable machine-readable sub-code for a code that has several causes, today
    // webhook_invalid (not_https, host_not_allowed, ...). Never carries user input such as the URL.
    reason: z.string().optional().describe("A stable sub-code for the error, when the code has several causes"),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
