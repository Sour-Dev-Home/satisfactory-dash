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
not_editable 409 (ADR-0012), rate_limited 429 (ADR-0011), internal 500.
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

## Revisit when

Public API consumers exist (then consider RFC 9457 problem+json).
