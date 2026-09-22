import { formatErrorDetail } from "./formatErrorDetail.js";

/** Loosely duck-typed rather than importing FrmApiRequestError/VanillaApiRequestError
 *  directly -- routes/ shouldn't need to know adapter-specific error classes, just
 *  that "something with a status or errorCode" implies a real server response was
 *  received (auth/validation failure), not a connectivity problem. Found by a
 *  review pass: every failure (unreachable server, a 401 from a bad token, a JSON
 *  parse error, an adapter crash) previously got the same "Could not reach..."
 *  message, which is actively wrong for anything that isn't a connectivity issue. */
function describeFailure(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const status = "status" in err ? err.status : undefined;
    if (typeof status === "number") {
      return status === 401 || status === 403
        ? "Satisfactory dedicated server rejected the request (check the configured auth token)"
        : `Satisfactory dedicated server request failed (status ${status})`;
    }
    const errorCode = "errorCode" in err ? err.errorCode : undefined;
    if (typeof errorCode === "string" && errorCode.length > 0) {
      return `Satisfactory dedicated server request failed (${errorCode})`;
    }
  }
  return "Could not reach the Satisfactory dedicated server";
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
