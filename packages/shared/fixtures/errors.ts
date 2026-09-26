import type { ApiErrorResponse, HealthResponse, ReadinessResponse } from "../src/index";

export const healthOk = { status: "ok" } satisfies HealthResponse;

/** GET /api/health/ready (ADR-0025): 200 when the dependencies answer... */
export const readinessOk = { status: "ok" } satisfies ReadinessResponse;

/** ...and 503 with this body when they don't. It never says which dependency failed. */
export const readinessUnavailable = { status: "unavailable" } satisfies ReadinessResponse;

/** A signed-in user whose role doesn't allow the action (403). A non-member of the server gets
 *  server_not_found instead, so the server's existence isn't revealed (ADR-0025). */
export const errorForbidden = {
  error: {
    code: "forbidden",
    message: "You don't have permission to do that on this server",
    requestId: "00000000-0000-4000-8000-000000000012",
  },
} satisfies ApiErrorResponse;

/** The database (or another required dependency) is unavailable (503). A session lookup that
 *  fails because the database is down is this, never a 401 (ADR-0025 decision 6). */
export const errorServiceUnavailable = {
  error: {
    code: "service_unavailable",
    message: "The service is temporarily unavailable",
    requestId: "00000000-0000-4000-8000-000000000013",
  },
} satisfies ApiErrorResponse;

export const errorUpstreamUnreachable = {
  error: {
    code: "upstream_unreachable",
    message: "Could not reach the Satisfactory dedicated server",
    requestId: "00000000-0000-4000-8000-000000000000",
  },
} satisfies ApiErrorResponse;

/** How a response looks in development/test, where `detail` is included. */
export const errorWithDetail = {
  error: {
    code: "upstream_invalid_response",
    message: "Satisfactory dedicated server returned an invalid response",
    requestId: "00000000-0000-4000-8000-000000000002",
    detail: "FrmApiRequestError: FRM response from getPower was not an array",
  },
} satisfies ApiErrorResponse;

/** A code this client doesn't know yet; clients must handle it generically (ADR-0003). */
export const errorUnknownCode = {
  error: {
    code: "some_future_code",
    message: "Something went wrong",
    requestId: "00000000-0000-4000-8000-000000000001",
  },
} satisfies ApiErrorResponse;

/** POST /api/auth/login with a wrong username or password (401). The message doesn't
 *  say which one was wrong. */
export const errorLoginFailed = {
  error: {
    code: "unauthorized",
    message: "Invalid username or password",
    requestId: "00000000-0000-4000-8000-000000000003",
  },
} satisfies ApiErrorResponse;

/** Any protected route without a valid session cookie (401): the frontend goes to login. */
export const errorSessionRequired = {
  error: {
    code: "unauthorized",
    message: "Sign in to continue",
    requestId: "00000000-0000-4000-8000-000000000004",
  },
} satisfies ApiErrorResponse;

/** Too many login attempts from one IP (429). */
export const errorRateLimited = {
  error: {
    code: "rate_limited",
    message: "Too many login attempts. Try again later.",
    requestId: "00000000-0000-4000-8000-000000000005",
  },
} satisfies ApiErrorResponse;

/** PUT .../settings/auto-pause when no verified Administrator token is configured (409). */
export const errorNotEditable = {
  error: {
    code: "not_editable",
    message: "This server's settings can't be changed: no administrator token is configured",
    requestId: "00000000-0000-4000-8000-000000000006",
  },
} satisfies ApiErrorResponse;

/** An unknown /api route (404). Not server_not_found, which means an unknown game-server
 *  id and may make the frontend re-run server discovery. */
export const errorNotFound = {
  error: {
    code: "not_found",
    message: "No such API endpoint",
    requestId: "00000000-0000-4000-8000-000000000007",
  },
} satisfies ApiErrorResponse;

/** A request body over the size limit (413). */
export const errorPayloadTooLarge = {
  error: {
    code: "payload_too_large",
    message: "The request body is too large",
    requestId: "00000000-0000-4000-8000-000000000008",
  },
} satisfies ApiErrorResponse;

/** A mutation sent with a non-JSON body or an unsupported encoding (415). Mutations
 *  accept application/json only (ADR-0011). */
export const errorUnsupportedMediaType = {
  error: {
    code: "unsupported_media_type",
    message: "Send the request body as application/json",
    requestId: "00000000-0000-4000-8000-000000000009",
  },
} satisfies ApiErrorResponse;

/** A well-formed server id that no configured server has (404). The frontend may
 *  re-run server discovery on this code. Message as the backend sends it. */
export const errorServerNotFound = {
  error: {
    code: "server_not_found",
    message: "No server with that id",
    requestId: "00000000-0000-4000-8000-000000000010",
  },
} satisfies ApiErrorResponse;

/** The game server rejected the backend's configured token (502). Message as the
 *  backend sends it. */
export const errorUpstreamAuthRejected = {
  error: {
    code: "upstream_auth_rejected",
    message: "Satisfactory dedicated server rejected the request (check the configured auth token)",
    requestId: "00000000-0000-4000-8000-000000000011",
  },
} satisfies ApiErrorResponse;

// ADR-0027 PR 7: the alerts error codes. Messages are safe to show; none of them names a URL, a token or a host.

/** 404: no such rule on this server (also a rule of another server: existence is not revealed). */
export const errorRuleNotFound = {
  error: { code: "rule_not_found", message: "That alert rule was not found on this server", requestId: "00000000-0000-4000-8000-0000000000a1" },
} satisfies ApiErrorResponse;

/** 422: a PATCH that includes `item`. To watch another item, create a new rule. */
export const errorRuleItemImmutable = {
  error: {
    code: "rule_item_immutable",
    message: "A rule's item cannot be changed. Create a new rule for another item.",
    requestId: "00000000-0000-4000-8000-0000000000a2",
  },
} satisfies ApiErrorResponse;

/** 409: DELETE on a preset. Disable it instead. */
export const errorPresetDisableOnly = {
  error: { code: "preset_disable_only", message: "A preset rule can be disabled but not deleted", requestId: "00000000-0000-4000-8000-0000000000a3" },
} satisfies ApiErrorResponse;

/** 422: POST with a kind that cannot be created through the API. */
export const errorRuleKindNotCreatable = {
  error: { code: "rule_kind_not_creatable", message: "That kind of rule cannot be created", requestId: "00000000-0000-4000-8000-0000000000a4" },
} satisfies ApiErrorResponse;

/** 404: no Discord destination is set up (test, PATCH or DELETE). */
export const errorDestinationNotConfigured = {
  error: { code: "destination_not_configured", message: "No Discord webhook is set up for this server", requestId: "00000000-0000-4000-8000-0000000000a5" },
} satisfies ApiErrorResponse;

/** 422: the webhook URL was refused. `reason` says why (not_https, host_not_allowed, ...); the URL is never echoed. */
export const errorWebhookInvalid = {
  error: {
    code: "webhook_invalid",
    message: "That is not a valid Discord webhook URL",
    requestId: "00000000-0000-4000-8000-0000000000a6",
    reason: "host_not_allowed",
  },
} satisfies ApiErrorResponse;

/** 409: the delivery kill switch is off, so nothing can be sent. */
export const errorDeliveryOff = {
  error: { code: "delivery_off", message: "Alert delivery is switched off, so no message was sent", requestId: "00000000-0000-4000-8000-0000000000a7" },
} satisfies ApiErrorResponse;

/** 422: the mute time is not in the future, or is more than 7 days ahead. */
export const errorMuteInvalid = {
  error: { code: "mute_invalid", message: "Choose a time in the future, at most 7 days ahead", requestId: "00000000-0000-4000-8000-0000000000a8" },
} satisfies ApiErrorResponse;
