import https from "node:https";
import { UpstreamError } from "./errors.js";
import type { RequestFailureKind } from "./errors.js";

/**
 * Low-level client for the vanilla Satisfactory Dedicated Server HTTPS API. One POST
 * endpoint, JSON-RPC-style: {"function": name, "data": {...}} in, either a Success
 * Response ({"data": ...}) or an Error Response ({"errorCode", ...}) out. See
 * docs-vault/raw-sources/dedicated-server-api.md for the documented schema.
 *
 * Response field casing is camelCase in practice (confirmed live in the Phase 2
 * spike), not the PascalCase shown in the docs — see
 * docs-vault/raw-sources/captured-responses/vanilla-QueryServerState-sample.json.
 * Callers must type responses against real samples, not the doc tables.
 */

export interface VanillaApiTransportResult {
  status: number;
  body: unknown;
}

/** Sends one POST request and returns the parsed JSON body + status code. Swappable
 *  for tests so client logic can be verified without a real TLS socket. */
export type VanillaApiTransport = (payload: {
  host: string;
  port: number;
  authToken?: string;
  timeoutMs: number;
  allowSelfSignedCert: boolean;
  requestBody: unknown;
}) => Promise<VanillaApiTransportResult>;

export interface VanillaApiClientOptions {
  host: string;
  port: number;
  authToken?: string;
  allowSelfSignedCert: boolean;
  timeoutMs: number;
  transport?: VanillaApiTransport;
}

/** `status` is the HTTP status when the server answered with >= 400. Found by a
 *  review pass: without it, routes/errorResponse.ts could never tell a 401/403 (bad
 *  token) on /api/status apart from any other failure. */
export class VanillaApiRequestError extends UpstreamError {
  constructor(
    message: string,
    errorCode?: string,
    public readonly errorData?: unknown,
    options?: ErrorOptions & { failureKind?: RequestFailureKind; status?: number },
  ) {
    super(message, { ...options, errorCode });
    this.name = "VanillaApiRequestError";
  }
}

interface VanillaApiErrorBody {
  errorCode: string;
  errorMessage?: string;
  errorData?: unknown;
}

function isErrorBody(body: unknown): body is VanillaApiErrorBody {
  return typeof body === "object" && body !== null && "errorCode" in body;
}

/** The request function is injectable so the transport's event handling can be tested
 *  against a real local socket (vanillaTransport.test.ts). */
export const createVanillaApiTransport =
  (request: typeof https.request = https.request): VanillaApiTransport =>
  ({ host, port, authToken, timeoutMs, allowSelfSignedCert, requestBody }) =>
  new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(requestBody), "utf-8");
    const req = request(
      {
        host,
        port,
        path: "/api/v1",
        method: "POST",
        // Two limits, deliberately. `timeout` is an IDLE-socket timeout: it never fires while a
        // server keeps sending bytes. `signal` is an OVERALL deadline for the whole request
        // and response, like FRM's (frmApiClient.ts), so a server that trickles bytes forever
        // can't hold a request, or the power history poller, open. Hitting it destroys the
        // request; the handlers below classify that as unreachable (-> 503).
        timeout: timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
        rejectUnauthorized: !allowSelfSignedCert,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        // Issue #8, item 1: if the connection drops after the headers arrived, neither
        // "end" nor the request's "error" fires, so the promise never settled and
        // /api/status hung (the timeout doesn't help once the socket is gone). The
        // response's own "error", and a "close" before the body was complete, both mean
        // the server became unreachable mid-response. Rejecting twice is harmless.
        const dropped = (cause?: unknown) =>
          reject(
            new VanillaApiRequestError("Vanilla API connection dropped mid-response", undefined, undefined, {
              cause,
              failureKind: "unreachable",
            }),
          );
        res.on("error", dropped);
        res.on("close", () => {
          if (!res.complete) {
            dropped();
          }
        });
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const raw = Buffer.concat(chunks).toString("utf-8");
          if (!raw) {
            resolve({ status, body: undefined });
            return;
          }
          try {
            resolve({ status, body: JSON.parse(raw) });
          } catch (err) {
            // A non-JSON error page (a proxy's HTML 502, a bare 401) still has a
            // meaningful status -- hand it to call() rather than hiding it behind
            // "invalid response". Found by a review pass.
            if (status >= 400) {
              resolve({ status, body: undefined });
              return;
            }
            reject(
              new VanillaApiRequestError("Vanilla API returned non-JSON body", undefined, undefined, {
                cause: err,
                failureKind: "invalid_response",
              }),
            );
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Vanilla API request timed out")));
    // Classified here, where it's known to be a connection-level failure (refused,
    // DNS, TLS, the timeout above), so routes/errorResponse.ts can say "Could not
    // reach" only when that's actually what happened. The original error rides
    // along as .cause for formatErrorDetail.ts to unwrap.
    req.on("error", (err) =>
      reject(
        new VanillaApiRequestError("Vanilla API request failed", undefined, undefined, {
          cause: err,
          failureKind: "unreachable",
        }),
      ),
    );
    req.write(payload);
    req.end();
  });

export const defaultVanillaApiTransport: VanillaApiTransport = createVanillaApiTransport();

export class VanillaApiClient {
  private readonly transport: VanillaApiTransport;

  constructor(private readonly options: VanillaApiClientOptions) {
    this.transport = options.transport ?? defaultVanillaApiTransport;
  }

  async call<T>(functionName: string, data?: unknown): Promise<T> {
    const { status, body } = await this.transport({
      host: this.options.host,
      port: this.options.port,
      authToken: this.options.authToken,
      timeoutMs: this.options.timeoutMs,
      allowSelfSignedCert: this.options.allowSelfSignedCert,
      requestBody: data === undefined ? { function: functionName } : { function: functionName, data },
    });

    if (isErrorBody(body)) {
      throw new VanillaApiRequestError(body.errorMessage ?? body.errorCode, body.errorCode, body.errorData, {
        status: status >= 400 ? status : undefined,
      });
    }
    if (status >= 400) {
      throw new VanillaApiRequestError(`Vanilla API request failed with status ${status}`, undefined, undefined, {
        status,
      });
    }
    if (status === 204 || body === undefined) {
      return undefined as T;
    }
    if (body === null) {
      throw new VanillaApiRequestError("Vanilla API returned a null success body");
    }
    return (body as { data: T }).data;
  }
}
