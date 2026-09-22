import { formatErrorDetail } from "./formatErrorDetail.js";

const UNREACHABLE_MESSAGE = "Could not reach the Satisfactory dedicated server";
const FALLBACK_MESSAGE = "Request to the Satisfactory dedicated server failed";

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
 *  bug throwing a TypeError -- gets a neutral message that's true either way. */
function describeFailure(err: unknown): string {
  // This runs in every route's catch block, so it must not throw -- a later review
  // pass found a hostile `status` getter made it do exactly that, turning the 503
  // JSON body into Express's default non-JSON error page. formatErrorDetail.ts
  // guards every read the same way.
  try {
    return describeFailureUnsafe(err);
  } catch {
    return FALLBACK_MESSAGE;
  }
}

function describeFailureUnsafe(err: unknown): string {
  if (err === null || typeof err !== "object") {
    return FALLBACK_MESSAGE;
  }
  const status = "status" in err ? err.status : undefined;
  // Number.isInteger + range, not typeof === "number": that accepted NaN, 0 and
  // negatives, producing messages like "request failed (status NaN)".
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
    return status === 401 || status === 403
      ? "Satisfactory dedicated server rejected the request (check the configured auth token)"
      : `Satisfactory dedicated server request failed (status ${status})`;
  }
  const errorCode = "errorCode" in err ? err.errorCode : undefined;
  if (typeof errorCode === "string" && errorCode.length > 0) {
    return `Satisfactory dedicated server request failed (${errorCode})`;
  }
  const failureKind = "failureKind" in err ? err.failureKind : undefined;
  if (failureKind === "unreachable") {
    return UNREACHABLE_MESSAGE;
  }
  if (failureKind === "invalid_response") {
    return "Satisfactory dedicated server returned an invalid response";
  }
  return FALLBACK_MESSAGE;
}

/** `detail` is safe to include only in these NODE_ENV values -- an explicit
 *  allowlist, not "anything except production", per the reasoning on
 *  `buildServerUnreachableResponse` below. `development` is `npm run dev`
 *  (package.json sets it explicitly via cross-env specifically so this doesn't
 *  have to treat "unset" as safe -- see that script). `test` is Vitest, which
 *  sets it automatically (see backend/CLAUDE.md) and existing route/service tests
 *  assert `detail` is present. */
const DETAIL_SAFE_NODE_ENVS = new Set(["development", "test"]);

/**
 * Shared 503 body for all three business routes. Found by a review pass: once
 * frmApiClient.ts started setting `{ cause: err }` (fixing the bug that made
 * formatErrorDetail's `.cause`-unwrapping do nothing in practice), `detail`
 * started faithfully including the internal FRM server's host:port from Node's own
 * `connect ECONNREFUSED <ip>:<port>` text — leaking infrastructure detail into a
 * public, unauthenticated response body. This project is meant to go public-facing
 * per DEPLOYMENT.md, so that's a real concern, not a hypothetical one.
 *
 * Full `detail` is always logged server-side (for whoever's operating the
 * dashboard) but only included in the response for an allowlisted NODE_ENV. Opt-IN
 * to known-safe values, not opt-OUT of `production`: the original
 * `NODE_ENV === "production"` check left detail exposed for anything else (unset,
 * "", "prod", "Production", "staging") — only the Dockerfile's own explicit
 * `NODE_ENV=production` was actually safe. Any other way of starting the server
 * (bare `node dist/server.cjs`, a hosting platform, a staging setup with no
 * NODE_ENV set) would have silently kept leaking. Defaulting to redacted unless
 * explicitly recognized as safe is the safer failure direction.
 */
export function buildServerUnreachableResponse(err: unknown): { error: string; detail?: string } {
  const error = describeFailure(err);
  const detail = formatErrorDetail(err);
  console.error(`[${error}]`, detail);
  if (!DETAIL_SAFE_NODE_ENVS.has(process.env.NODE_ENV ?? "")) {
    return { error };
  }
  return { error, detail };
}
