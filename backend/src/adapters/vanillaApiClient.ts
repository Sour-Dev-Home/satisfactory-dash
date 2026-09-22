import https from "node:https";

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

export class VanillaApiRequestError extends Error {
  constructor(
    message: string,
    public readonly errorCode?: string,
    public readonly errorData?: unknown,
  ) {
    super(message);
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

export const defaultVanillaApiTransport: VanillaApiTransport = ({
  host,
  port,
  authToken,
  timeoutMs,
  allowSelfSignedCert,
  requestBody,
}) =>
  new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(requestBody), "utf-8");
    const req = https.request(
      {
        host,
        port,
        path: "/api/v1",
        method: "POST",
        timeout: timeoutMs,
        rejectUnauthorized: !allowSelfSignedCert,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
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
            reject(new Error(`Vanilla API returned non-JSON body: ${String(err)}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Vanilla API request timed out")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

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
      throw new VanillaApiRequestError(body.errorMessage ?? body.errorCode, body.errorCode, body.errorData);
    }
    if (status >= 400) {
      throw new VanillaApiRequestError(`Vanilla API request failed with status ${status}`);
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
