import { gzipSync } from "node:zlib";
import { AgentCommandsResponseSchema, ApiErrorResponseSchema, CommandResultResponseSchema, EnrollResponseSchema, SnapshotResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { AgentCommand, Cadence, CommandResultRequest, EnrollResponse, SnapshotRequest, SnapshotResponse } from "@satisfactory-dash/shared";
import type { z } from "zod";
import { AGENT_VERSION } from "./version.js";

/**
 * The agent's HTTP client for the backend's `/agent/v1` API (ADR-0031 PR 6). Its rules (architect):
 *  - The base URL must be https; plain http is allowed ONLY for localhost during development. It is an origin: no path,
 *    no credentials, no query.
 *  - `redirect: "manual"`, and a 3xx is an error: the Bearer credential must never follow a redirect to another origin.
 *  - Every request has a timeout. A network failure, a timeout, a 5xx or a 429 is TRANSIENT (the caller backs off with
 *    jitter and retries); a 401 is AUTH REJECTED (the caller stops and tells the owner to re-enrol, never retries forever);
 *    any other 4xx is FATAL for that request.
 *  - Errors carry a kind, a status and the backend's error CODE only: never a response body, a header or the secret.
 */

export type BackendErrorKind = "transient" | "auth_rejected" | "fatal";

export class BackendError extends Error {
  constructor(
    readonly kind: BackendErrorKind,
    message: string,
    readonly details: { status?: number; code?: string; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "BackendError";
  }
  get status(): number | undefined {
    return this.details.status;
  }
  /** The backend's own error code (`command_expired`, `rate_limited`, ...), when it sent one. */
  get code(): string | undefined {
    return this.details.code;
  }
  get retryAfterMs(): number | undefined {
    return this.details.retryAfterMs;
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const REQUEST_TIMEOUT_MS = 15_000;
/** A long-poll may sit at the server for up to 25 s; the client waits that plus this much. */
export const LONG_POLL_GRACE_MS = 10_000;
/** Bodies larger than this are gzip-compressed (the backend inflates them and caps the DECOMPRESSED size). */
export const GZIP_OVER_BYTES = 1_024;
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_RETRY_AFTER_MS = 300_000;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Validates the backend address the owner typed. Returns its origin; throws a `BackendError` (fatal) that says what is wrong. */
export function parseBackendUrl(raw: string): string {
  const fail = (why: string) => new BackendError("fatal", `The backend address is not usable: ${why}.`);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw fail("it is not a valid URL");
  }
  if (url.username !== "" || url.password !== "") throw fail("it must not contain a user name or password");
  if (url.search !== "" || url.hash !== "") throw fail("it must not contain a query or a fragment");
  if (url.pathname !== "/" && url.pathname !== "") throw fail("it must be an origin only (for example https://api.example.com), without a path");
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.origin;
  throw fail("it must start with https:// (plain http is allowed only for localhost while developing)");
}

export interface BackendClientOptions {
  baseUrl: string;
  /** The agent's credential; absent only for `enroll`. */
  agentSecret?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  agentVersion?: string;
}

interface RequestSpec<S extends z.ZodType> {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  authenticated: boolean;
  schema: S;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1000));
}

export class BackendClient {
  private readonly origin: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: BackendClientOptions) {
    this.origin = parseBackendUrl(options.baseUrl);
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** POST /agent/v1/enroll: exchanges the one-time code for the credential. Not authenticated by a Bearer. */
  enroll(code: string): Promise<EnrollResponse> {
    return this.request({
      method: "POST",
      path: endpoints.agentApi.enroll.path(),
      body: { code, agentVersion: this.options.agentVersion ?? AGENT_VERSION },
      authenticated: false,
      schema: EnrollResponseSchema,
    });
  }

  /** POST /agent/v1/snapshots. The answer carries the current cadence and whether a command is waiting. */
  postSnapshot(snapshot: SnapshotRequest, signal?: AbortSignal): Promise<SnapshotResponse> {
    return this.request({ method: "POST", path: endpoints.agentApi.snapshots.path(), body: snapshot, authenticated: true, schema: SnapshotResponseSchema, signal });
  }

  /** GET /agent/v1/commands?waitSeconds=N: a long-poll (0 to 25 seconds). */
  async pollCommands(waitSeconds: number, signal?: AbortSignal): Promise<AgentCommand[]> {
    const wait = Math.max(0, Math.min(25, Math.floor(waitSeconds)));
    const response = await this.request({
      method: "GET",
      path: `${endpoints.agentApi.commands.path()}?waitSeconds=${wait}`,
      authenticated: true,
      schema: AgentCommandsResponseSchema,
      timeoutMs: wait * 1000 + LONG_POLL_GRACE_MS,
      signal,
    });
    return response.commands;
  }

  /** POST /agent/v1/commands/:id/result. `command_not_found` and `command_expired` arrive as a fatal BackendError with that code. */
  async postResult(commandId: string, result: CommandResultRequest): Promise<void> {
    await this.request({ method: "POST", path: endpoints.agentApi.result.path(commandId), body: result, authenticated: true, schema: CommandResultResponseSchema });
  }

  private async request<S extends z.ZodType>(spec: RequestSpec<S>): Promise<z.infer<S>> {
    const headers: Record<string, string> = { accept: "application/json", "user-agent": `satisfactory-dash-agent/${this.options.agentVersion ?? AGENT_VERSION}` };
    if (spec.authenticated) {
      if (this.options.agentSecret === undefined) throw new BackendError("fatal", "The agent has no credential yet: enrol it first.");
      headers.authorization = `Bearer ${this.options.agentSecret}`;
    }
    let body: string | Buffer | undefined;
    if (spec.body !== undefined) {
      const json = JSON.stringify(spec.body);
      headers["content-type"] = "application/json";
      if (Buffer.byteLength(json) > GZIP_OVER_BYTES) {
        body = gzipSync(json);
        headers["content-encoding"] = "gzip";
      } else {
        body = json;
      }
    }
    const timeout = AbortSignal.timeout(spec.timeoutMs ?? this.timeoutMs);
    const signal = spec.signal === undefined ? timeout : AbortSignal.any([timeout, spec.signal]);

    let response: Response;
    try {
      // `redirect: "manual"`: a redirect is never followed, so the Bearer cannot be replayed at another origin.
      response = await this.fetchImpl(`${this.origin}${spec.path}`, { method: spec.method, headers, body: body as RequestInit["body"], redirect: "manual", signal });
    } catch (err) {
      if (spec.signal?.aborted) throw err; // the caller cancelled (shutdown): not a failure to classify
      throw new BackendError("transient", timeout.aborted ? "The backend did not answer in time." : "The backend could not be reached.");
    }

    const status = response.status;
    if (status >= 300 && status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new BackendError("fatal", "The backend answered with a redirect, which the agent never follows. Check the backend address.", { status });
    }
    const text = await this.readBody(response);
    if (status === 401 && spec.authenticated) throw new BackendError("auth_rejected", "The backend rejected the agent's credential (401).", { status, code: errorCode(text) });
    if (status === 429 || status >= 500) {
      throw new BackendError("transient", `The backend answered ${status}.`, { status, code: errorCode(text), retryAfterMs: retryAfterMs(response) });
    }
    if (status < 200 || status >= 300) {
      throw new BackendError("fatal", `The backend refused the request (${status}${errorCode(text) !== undefined ? `, ${errorCode(text)}` : ""}).`, { status, code: errorCode(text) });
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BackendError("transient", "The backend's answer was not JSON (a proxy or captive page in the way?).", { status });
    }
    const parsed = spec.schema.safeParse(json);
    if (!parsed.success) throw new BackendError("transient", "The backend's answer was not in the expected form.", { status });
    return parsed.data;
  }

  private async readBody(response: Response): Promise<string> {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RESPONSE_CHARS) {
      await response.body?.cancel().catch(() => undefined);
      throw new BackendError("transient", "The backend's answer is too large.", { status: response.status });
    }
    // Read the stream and count as it arrives: a Content-Length can be missing or a lie (chunked, or a compression bomb), and
    // `response.text()` would buffer all of it. Past the cap the read stops and the rest is discarded.
    const reader = response.body?.getReader();
    if (reader === undefined) return "";
    const decoder = new TextDecoder("utf-8");
    let text = "";
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_CHARS) {
        await reader.cancel().catch(() => undefined);
        throw new BackendError("transient", "The backend's answer is too large.", { status: response.status });
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  }
}

/** The backend's error code from an error body, or undefined. Only the code is kept, never the message or the body. */
function errorCode(text: string): string | undefined {
  try {
    const parsed = ApiErrorResponseSchema.safeParse(JSON.parse(text));
    return parsed.success && /^[a-z0-9_]{1,64}$/.test(parsed.data.error.code) ? parsed.data.error.code : undefined;
  } catch {
    return undefined;
  }
}

export type { Cadence };
