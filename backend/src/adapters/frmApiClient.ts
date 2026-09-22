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
  ) {
    super(message);
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
      throw new FrmApiRequestError(`FRM request to ${endpoint} failed: ${String(err)}`);
    }
  }
}
