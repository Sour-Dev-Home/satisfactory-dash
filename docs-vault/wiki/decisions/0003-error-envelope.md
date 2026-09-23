# ADR-0003: One error envelope, with a request id

Status: accepted, 2026-09-22

## Context

Routes currently return { error, detail } with status 503 for every failure
(routes/errorResponse.ts; per-route try/catch in routes/{status,factory,power}.ts:8-12). Auth
rejections and malformed upstream data are reported as "unreachable". The detail allowlist
(errorResponse.ts:62, :87-90) already hides internals outside dev/test.

## Decision

Every non-2xx body is { error: { code, message, requestId, detail? } }.
code -> HTTP, mapped only in the backend's Express error middleware:
upstream_unreachable 503, upstream_auth_rejected 502, upstream_invalid_response 502,
upstream_error 502, server_not_found 404, bad_request 400, unauthorized 401 (ADR-0011),
not_editable 409 (ADR-0012), rate_limited 429 (ADR-0011), internal 500,
not_found 404, payload_too_large 413, unsupported_media_type 415 (amendment below).
Each code maps to exactly one status; nothing else changes the status of a response.
`code` is z.string() on the wire, with KnownErrorCode exported; clients handle unknown codes
generically, so adding a code is non-breaking. `detail` keeps the existing dev/test-only rule.
requestId is crypto.randomUUID() from middleware, echoed in X-Request-Id and bound to every log
line. An inbound X-Request-Id isn't trusted until a proxy we control sets it.
describeFailure (errorResponse.ts:17-53) keeps its inputs and classification branches; only its
output ({ code, message }) and the status codes change, and its tests are updated to match.
The per-route try/catch is replaced by the error middleware (Express 5 forwards rejected async
handlers; confirm in the Express docs when implementing).

## Consequences

Users see a safe message plus an id they can report; the full error lives in logs
under the same id. The frontend switches on `code`, not status text.

## Amendment, 2026-09-23

Added three codes after a review found an unknown /api route returned Express's HTML
404 page, and body-parser 413/415 errors were collapsed into a 400. `not_found` is an
unknown /api route; it is distinct from `server_not_found` (an unknown game-server id,
which may make the frontend re-run server discovery). `payload_too_large` and
`unsupported_media_type` come from the JSON body parser; mutations accept
application/json only (ADR-0011). Additive, so no version change (ADR-0007).

A wrong HTTP method on a known path (e.g. GET /api/auth/login) also answers 404
`not_found`, the same as any unmatched method and path; there is no 405 (decided
2026-09-23). With no external consumers (ADR-0007), one "not found" answer leaks less
about which routes exist. Revisit only if a public API consumer appears.

## Revisit when

Public API consumers exist (then consider RFC 9457 problem+json).
