import type { ErrorRequestHandler } from "express";
import type { Logger } from "pino";
import type { ApiErrorResponse, KnownErrorCode } from "@satisfactory-dash/shared";
import { formatErrorDetail } from "./formatErrorDetail.js";
import { ContractViolationError } from "./sendValidated.js";

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

/** Loosely duck-typed rather than importing FrmApiRequestError/VanillaApiRequestError
 *  directly -- routes/ shouldn't need to know adapter-specific error classes, just
 *  the fields they carry: an HTTP `status`, a vanilla-API `errorCode`, or the
 *  adapters' own `failureKind` classification (adapters/domain.ts).
 *
 *  Found by review passes: every failure (unreachable server, a 401 from a bad
 *  token, a JSON parse error, an adapter crash) used to get the same "Could not
 *  reach..." message, which is actively wrong for anything that isn't a
 *  connectivity issue. So "Could not reach" now needs positive evidence
 *  (`failureKind: "unreachable"`), and anything unclassified -- e.g. an adapter
 *  bug throwing a TypeError -- gets a neutral message that's true either way, with
 *  code `internal`: until the adapter validates upstream data (PR 3), an
 *  unclassified error is our own unhandled case. */
export function describeFailure(err: unknown): ClassifiedFailure {
  // This runs for every failed request, so it must not throw -- a review pass found
  // a hostile `status` getter made it do exactly that, turning the JSON error body
  // into Express's default non-JSON error page. formatErrorDetail.ts guards every
  // read the same way.
  try {
    return describeFailureUnsafe(err);
  } catch {
    return { code: "internal", message: FALLBACK_MESSAGE };
  }
}

function describeFailureUnsafe(err: unknown): ClassifiedFailure {
  if (err === null || typeof err !== "object") {
    return { code: "internal", message: FALLBACK_MESSAGE };
  }
  const status = "status" in err ? err.status : undefined;
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
  const errorCode = "errorCode" in err ? err.errorCode : undefined;
  if (typeof errorCode === "string" && errorCode.length > 0) {
    return { code: "upstream_error", message: `Satisfactory dedicated server request failed (${errorCode})` };
  }
  const failureKind = "failureKind" in err ? err.failureKind : undefined;
  if (failureKind === "unreachable") {
    return { code: "upstream_unreachable", message: UNREACHABLE_MESSAGE };
  }
  if (failureKind === "invalid_response") {
    return { code: "upstream_invalid_response", message: "Satisfactory dedicated server returned an invalid response" };
  }
  return { code: "internal", message: FALLBACK_MESSAGE };
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
    return { code: "internal", message: "Internal server error" };
  }
  if (err instanceof RouteNotFoundError) {
    return { code: "not_found", message: "No such API endpoint" };
  }
  // Each body-parser status gets its own code, so the code alone decides the HTTP
  // status (ADR-0003 amendment); anything else is a generic 400.
  switch (clientRequestErrorStatus(err)) {
    case undefined:
      return describeFailure(err);
    case 413:
      return { code: "payload_too_large", message: "The request body is too large" };
    case 415:
      return { code: "unsupported_media_type", message: "Send the request body as application/json" };
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

    const body: ApiErrorResponse = { error: { code, message, requestId } };
    if (DETAIL_SAFE_NODE_ENVS.has(process.env.NODE_ENV ?? "")) {
      body.error.detail = detail;
    }
    res.status(HTTP_STATUS_BY_CODE[code]).json(body);
  };
}
