import type { ErrorRequestHandler } from "express";
import type { Logger } from "pino";
import type { ApiErrorResponse, KnownErrorCode } from "@satisfactory-dash/shared";
import { formatErrorDetail } from "./formatErrorDetail.js";
import { ContractViolationError } from "./sendValidated.js";
import { UpstreamError } from "./errors.js";

const UNREACHABLE_MESSAGE = "Could not reach the Satisfactory dedicated server";
const FALLBACK_MESSAGE = "Request to the Satisfactory dedicated server failed";

export interface ClassifiedFailure {
  code: KnownErrorCode;
  message: string;
}

/**
 * ADR-0003: the ONE place error codes map to HTTP status. Upstream problems are 502
 * (the game server answered badly) or 503 (it couldn't be reached); only our own bugs
 * are 500.
 */
export const HTTP_STATUS_BY_CODE: Record<KnownErrorCode, number> = {
  upstream_unreachable: 503,
  upstream_auth_rejected: 502,
  upstream_invalid_response: 502,
  upstream_error: 502,
  server_not_found: 404,
  not_found: 404,
  bad_request: 400,
  payload_too_large: 413,
  unsupported_media_type: 415,
  unauthorized: 401,
  not_editable: 409,
  rate_limited: 429,
  internal: 500,
};

const INTERNAL_MESSAGE = "Internal server error";

/** The vanilla API's errorCode reaches the public `message`, so bound what the game
 *  server (or anything pretending to be it) can put there: at most 64 characters from
 *  a safe set (issue #8, item 4). */
function safeErrorCode(errorCode: string): string {
  return errorCode.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
}

/**
 * Maps an error to its ADR-0003 code. Upstream codes (502/503) come ONLY from an
 * `UpstreamError` (platform/errors.ts), the base class of every adapter transport,
 * HTTP-status, error-body and validation failure. Anything else fails closed as our
 * own `internal` 500, even if it carries a numeric `status` (architect ruling, PR 3):
 * a review of PR #16 found Express's router throwing a URIError with `status: 400`
 * that this function, then duck-typed, blamed on the game server.
 *
 * Earlier review passes still apply inside the upstream branch: "Could not reach"
 * needs positive evidence (`failureKind: "unreachable"`), a 401/403 gets the auth
 * hint, and an out-of-range status is ignored.
 */
export function describeFailure(err: unknown): ClassifiedFailure {
  // This runs for every failed request, so it must not throw -- a review pass found
  // a hostile `status` getter made it do exactly that, turning the JSON error body
  // into Express's default non-JSON error page. formatErrorDetail.ts guards every
  // read the same way.
  try {
    return describeFailureUnsafe(err);
  } catch {
    return { code: "internal", message: INTERNAL_MESSAGE };
  }
}

function describeFailureUnsafe(err: unknown): ClassifiedFailure {
  if (!(err instanceof UpstreamError)) {
    return { code: "internal", message: INTERNAL_MESSAGE };
  }
  const { status, errorCode, failureKind } = err;
  // Number.isInteger + range, not typeof === "number": that accepted NaN, 0 and
  // negatives, producing messages like "request failed (status NaN)".
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
    return status === 401 || status === 403
      ? {
          code: "upstream_auth_rejected",
          message: "Satisfactory dedicated server rejected the request (check the configured auth token)",
        }
      : { code: "upstream_error", message: `Satisfactory dedicated server request failed (status ${status})` };
  }
  if (typeof errorCode === "string" && safeErrorCode(errorCode).length > 0) {
    return {
      code: "upstream_error",
      message: `Satisfactory dedicated server request failed (${safeErrorCode(errorCode)})`,
    };
  }
  if (failureKind === "unreachable") {
    return { code: "upstream_unreachable", message: UNREACHABLE_MESSAGE };
  }
  if (failureKind === "invalid_response") {
    return { code: "upstream_invalid_response", message: "Satisfactory dedicated server returned an invalid response" };
  }
  return { code: "upstream_error", message: FALLBACK_MESSAGE };
}

/** A :serverId that isn't a valid server id (ADR-0001: ^[a-z0-9-]{1,32}$). */
export class InvalidServerIdError extends Error {
  constructor() {
    super("Invalid server id");
    this.name = "InvalidServerIdError";
  }
}

/** A well-formed :serverId that no configured server has. The frontend may react by
 *  re-running server discovery, which is why this is not `not_found`. */
export class ServerNotFoundError extends Error {
  constructor() {
    super("No server with that id");
    this.name = "ServerNotFoundError";
  }
}

/** No valid session (ADR-0011), or failed credentials. The message is shown to the
 *  user, so for a failed login it must not say which part was wrong. */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Too many failed logins from one IP (ADR-0011). Sets Retry-After. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many login attempts. Try again later.");
    this.name = "RateLimitedError";
  }
}

/** A mutation whose body isn't JSON (ADR-0011: mutations accept JSON only). */
export class UnsupportedMediaTypeError extends Error {
  constructor() {
    super("Send the request body as application/json");
    this.name = "UnsupportedMediaTypeError";
  }
}

/** A request body that doesn't match its contract schema. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

/** Thrown by the /api catch-all in app.ts for a path no router matched. */
export class RouteNotFoundError extends Error {
  constructor() {
    super("No such API endpoint");
    this.name = "RouteNotFoundError";
  }
}

/** A client-side problem with OUR request (e.g. express.json() rejecting a malformed,
 *  oversized or wrongly encoded body). Those errors come from http-errors with
 *  `expose: true` and a 4xx `statusCode`. They must be caught before describeFailure,
 *  whose `status` branch would otherwise report them as the game server's fault.
 *  Returns the status, or undefined when `err` isn't one. */
function clientRequestErrorStatus(err: unknown): number | undefined {
  try {
    if (err === null || typeof err !== "object" || !("expose" in err) || err.expose !== true) {
      return undefined;
    }
    const statusCode = "statusCode" in err ? err.statusCode : undefined;
    return typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500
      ? statusCode
      : undefined;
  } catch {
    return undefined;
  }
}

export function classifyRequestFailure(err: unknown): ClassifiedFailure {
  if (err instanceof ContractViolationError) {
    return { code: "internal", message: INTERNAL_MESSAGE };
  }
  if (err instanceof RouteNotFoundError) {
    return { code: "not_found", message: "No such API endpoint" };
  }
  if (err instanceof UnauthorizedError) {
    return { code: "unauthorized", message: err.message };
  }
  if (err instanceof RateLimitedError) {
    return { code: "rate_limited", message: err.message };
  }
  if (err instanceof UnsupportedMediaTypeError) {
    return { code: "unsupported_media_type", message: err.message };
  }
  if (err instanceof BadRequestError) {
    return { code: "bad_request", message: err.message };
  }
  if (err instanceof InvalidServerIdError) {
    return { code: "bad_request", message: "Invalid server id" };
  }
  if (err instanceof ServerNotFoundError) {
    return { code: "server_not_found", message: "No server with that id" };
  }
  // Express's router throws a URIError (with a bare `status: 400`, no `expose`) for a
  // broken percent-encoded route parameter. Without this, describeFailure's status
  // branch would blame our client's bad URL on the game server (found by PR #16's
  // fresh-eyes review).
  if (err instanceof URIError) {
    return { code: "bad_request", message: "The request URL is malformed" };
  }
  // Each body-parser status gets its own code, so the code alone decides the HTTP
  // status (ADR-0003 amendment); anything else is a generic 400.
  switch (clientRequestErrorStatus(err)) {
    case undefined:
      return describeFailure(err);
    case 413:
      return { code: "payload_too_large", message: "The request body is too large" };
    case 415:
      return {
        code: "unsupported_media_type",
        message: "The request body's content type or encoding isn't supported; send uncompressed application/json",
      };
    default:
      return { code: "bad_request", message: "The request was malformed" };
  }
}

/** `detail` is safe to include only in these NODE_ENV values -- an explicit
 *  allowlist, not "anything except production". `development` is `npm run dev`
 *  (package.json sets it explicitly via cross-env specifically so this doesn't
 *  have to treat "unset" as safe -- see that script). `test` is Vitest, which
 *  sets it automatically (see backend/CLAUDE.md). */
const DETAIL_SAFE_NODE_ENVS = new Set(["development", "test"]);

/**
 * ADR-0003's error envelope, from Express's error middleware: every rejected route
 * handler (Express 5 forwards them) and every thrown error lands here.
 *
 * Found by a review pass: `detail` faithfully includes the internal FRM server's
 * host:port (from Node's own `connect ECONNREFUSED <ip>:<port>` text), and the body
 * is public. So the full detail always goes to the log, bound to the request id, but
 * is only included in the body for an allowlisted NODE_ENV. Opt-IN to known-safe
 * values, not opt-OUT of `production`: the original `NODE_ENV === "production"`
 * check left detail exposed for anything else (unset, "", "prod", "staging").
 *
 * Express recognizes error middleware by arity, so this must keep exactly four
 * parameters.
 */
export function createErrorHandler(fallbackLogger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    // Too late for a JSON body (e.g. a stream failed mid-response): Express's default
    // handler closes the connection instead of writing a second response.
    if (res.headersSent) {
      next(err);
      return;
    }
    const { code, message } = classifyRequestFailure(err);
    const detail = formatErrorDetail(err);
    const log = req.log ?? fallbackLogger;
    const requestId = typeof req.id === "string" ? req.id : String(req.id ?? "unknown");
    log.error({ code, detail, requestId }, message);

    if (err instanceof RateLimitedError) {
      res.setHeader("Retry-After", String(err.retryAfterSeconds));
    }
    const body: ApiErrorResponse = { error: { code, message, requestId } };
    if (DETAIL_SAFE_NODE_ENVS.has(process.env.NODE_ENV ?? "")) {
      body.error.detail = detail;
    }
    res.status(HTTP_STATUS_BY_CODE[code]).json(body);
  };
}
