import { formatErrorDetail } from "./formatErrorDetail.js";

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
 * dashboard) but only included in the response when not running in production —
 * `NODE_ENV=production` gets the generic `error` message alone. This keeps
 * `detail` useful for local dev (where it's the whole reason it exists) without
 * shipping it to arbitrary internet clients once actually deployed.
 */
export function buildServerUnreachableResponse(err: unknown): { error: string; detail?: string } {
  const error = "Could not reach the Satisfactory dedicated server";
  const detail = formatErrorDetail(err);
  console.error(`[${error}]`, detail);
  if (process.env.NODE_ENV === "production") {
    return { error };
  }
  return { error, detail };
}
