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

export class FrmApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FrmApiRequestError";
  }
}

export class FrmApiClient {
  private readonly fetchImpl: FrmApiFetch;

  constructor(private readonly options: FrmApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get<T>(endpoint: string): Promise<T> {
    const url = `http://${this.options.host}:${this.options.port}/${endpoint}`;
    try {
      const res = await this.fetchImpl(url, {
        headers: this.options.authToken ? { "X-FRM-Authorization": this.options.authToken } : {},
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      if (!res.ok) {
        throw new FrmApiRequestError(`FRM request to ${endpoint} failed with status ${res.status}`, res.status);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof FrmApiRequestError) {
        throw err;
      }
      // { cause: err } (not just String(err) in the message) so the real underlying
      // reason -- e.g. fetch's own "TypeError: fetch failed" with an ECONNREFUSED
      // .cause -- survives for formatErrorDetail.ts to unwrap. Found by an
      // independent review pass: without this, formatErrorDetail's whole
      // .cause-unwrapping mechanism never actually fired for /api/factory or
      // /api/power in practice, since the cause was discarded right here before
      // ever reaching that helper.
      throw new FrmApiRequestError(`FRM request to ${endpoint} failed: ${String(err)}`, undefined, { cause: err });
    }
  }
}
