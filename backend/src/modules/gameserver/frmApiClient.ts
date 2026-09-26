/**
 * Low-level client for FicsitRemoteMonitoring's Web Server: plain HTTP GET per
 * endpoint (e.g. GET /getFactory), response is the documented JSON array/object
 * directly — no envelope. See docs-vault/raw-sources/frm-read-api.md for the
 * endpoint index and docs-vault/raw-sources/frm-get*.md for per-endpoint schemas.
 *
 * The docs also describe a transport tunneled through the vanilla API's port
 * (docs-vault/raw-sources/frm-dedicated-server.md); that returned 404 in the Phase 2
 * spike (docs-vault/raw-sources/captured-responses/frm-tunneled-transport-404.md), so
 * this client only implements the direct Web Server transport.
 */

import { UpstreamError } from "../../platform/errors.js";
import type { RequestFailureKind } from "../../platform/errors.js";

export type FrmApiFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface FrmApiClientOptions {
  host: string;
  port: number;
  /** Sent as X-FRM-Authorization per docs-vault/raw-sources/frm-authentication.md.
   *  [NEEDS VERIFICATION] — not live-tested against a token-enforcing instance. */
  authToken?: string;
  timeoutMs: number;
  fetchImpl?: FrmApiFetch;
}

export class FrmApiRequestError extends UpstreamError {
  constructor(
    message: string,
    status?: number,
    options?: ErrorOptions & { failureKind?: RequestFailureKind },
  ) {
    super(message, { ...options, status });
    this.name = "FrmApiRequestError";
  }
}

export class FrmApiClient {
  private readonly fetchImpl: FrmApiFetch;

  constructor(private readonly options: FrmApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get<T>(endpoint: string): Promise<T> {
    // An IPv6 literal (a pinned address, ADR-0030) needs brackets in a URL.
    const host = this.options.host.includes(":") && !this.options.host.startsWith("[") ? `[${this.options.host}]` : this.options.host;
    const url = `http://${host}:${this.options.port}/${endpoint}`;
    // Three separate failure points, each classified where it's actually known,
    // rather than one catch-all: a review pass found the old single try/catch made
    // a 200 response with malformed JSON indistinguishable from an unreachable
    // server, so /api/* reported "Could not reach the Satisfactory dedicated
    // server" for a server that had in fact answered.
    //
    // Each wrapper passes the original error as { cause } rather than folding
    // String(err) into the message -- the real reason (e.g. fetch's own
    // "TypeError: fetch failed" with an ECONNREFUSED .cause) survives for
    // formatErrorDetail.ts to unwrap, without the same text appearing twice.
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: this.options.authToken ? { "X-FRM-Authorization": this.options.authToken } : {},
        signal: AbortSignal.timeout(this.options.timeoutMs),
        // Never follow a redirect (ADR-0030): the address guard checks the first hop only, and fetch would send the
        // X-FRM-Authorization header on to wherever a 3xx points. A redirect is just an unexpected status below.
        redirect: "manual",
      });
    } catch (err) {
      throw new FrmApiRequestError(`FRM request to ${endpoint} failed`, undefined, {
        cause: err,
        failureKind: "unreachable",
      });
    }
    if (!res.ok) {
      throw new FrmApiRequestError(`FRM request to ${endpoint} failed with status ${res.status}`, res.status);
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      // A SyntaxError means the body arrived and wasn't JSON. Anything else here
      // (the connection dropping or the timeout firing mid-body) is still a
      // connectivity failure, even though headers already arrived.
      const invalidBody = err instanceof SyntaxError;
      throw new FrmApiRequestError(
        invalidBody ? `FRM response from ${endpoint} was not valid JSON` : `FRM request to ${endpoint} failed`,
        undefined,
        // A SyntaxError's message quotes a fragment of the body ("Unexpected token '<', "<html>Secr"..."),
        // which for getPlayer can be a player name (ADR-0029: never logged). Drop it as the cause.
        invalidBody
          ? { failureKind: "invalid_response" }
          : { cause: err, failureKind: "unreachable" },
      );
    }
  }
}
