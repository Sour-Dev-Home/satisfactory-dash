import { ApiErrorResponseSchema } from "@satisfactory-dash/shared";
import { ApiError, BackendUnreachableError, ContractDriftError, RequestValidationError } from "./errors";
import { transport } from "./transport";

// Re-exported so nothing but this module imports the transport (the demo build enforces it).
export { apiHref } from "./transport";

// The only module that builds API requests; transport.ts sends them (ADR-0026). Every body is
// parsed with the endpoint's shared schema (ADR-0002), so a shape mismatch surfaces as
// ContractDriftError, not a crash later.

const MAX_ISSUES = 5;

/** The subset of a zod schema this client uses; keeps zod out of the frontend's own deps. */
interface Schema<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
}

interface GetEndpoint<T, A extends unknown[]> {
  method: "GET";
  path: (...args: A) => string;
  response: Schema<T>;
}

interface SendEndpoint<T, B, A extends unknown[]> {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: (...args: A) => string;
  request?: Schema<B>;
  response: Schema<T>;
}

export function apiGet<T, A extends unknown[]>(endpoint: GetEndpoint<T, A>, ...args: A): Promise<T> {
  return request(endpoint.method, endpoint.path(...args), endpoint.response);
}

/**
 * apiGet that aborts the network request when `signal` fires. Queries pass TanStack's
 * signal, so a cancelled or unmounted query stops its fetch instead of discarding the result.
 */
export function apiGetAbortable<T, A extends unknown[]>(
  signal: AbortSignal,
  endpoint: GetEndpoint<T, A>,
  ...args: A
): Promise<T> {
  return request(endpoint.method, endpoint.path(...args), endpoint.response, undefined, signal);
}

interface QueryEndpoint<T, Q, A extends unknown[]> extends GetEndpoint<T, A> {
  query: Schema<Q>;
}

/**
 * apiGetAbortable for an endpoint with a query string (ADR-0027 history: `?range=`). The query is
 * checked with the endpoint's schema first, like a request body, so a bad value never goes out.
 */
export function apiGetQuery<T, Q extends Record<string, string | number>, A extends unknown[]>(
  signal: AbortSignal,
  endpoint: QueryEndpoint<T, Q, A>,
  query: Q,
  ...args: A
): Promise<T> {
  const path = endpoint.path(...args);
  const parsed = endpoint.query.safeParse(query);
  if (!parsed.success) return Promise.reject(new RequestValidationError(path, formatIssues(parsed.error.issues)));
  const search = new URLSearchParams(Object.entries(parsed.data).map(([k, v]) => [k, String(v)]));
  return request(endpoint.method, `${path}?${search}`, endpoint.response, undefined, signal);
}

/**
 * For endpoints without a request schema (logout, a DELETE), pass `undefined` as the body. When the
 * endpoint has one, the body is checked first and a mismatch rejects without sending.
 */
export async function apiSend<T, B, A extends unknown[]>(
  endpoint: SendEndpoint<T, B, A>,
  body: B,
  ...args: A
): Promise<T> {
  const path = endpoint.path(...args);
  if (endpoint.request) {
    const parsed = endpoint.request.safeParse(body);
    if (!parsed.success) throw new RequestValidationError(path, formatIssues(parsed.error.issues));
  }
  return request(endpoint.method, path, endpoint.response, body);
}

async function request<T>(
  method: string,
  path: string,
  schema: Schema<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const init: RequestInit = { method, credentials: "include", signal };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await transport(path, init);
  } catch (cause) {
    // Our own cancellation, not a dead backend: pass the AbortError through untouched.
    if (signal?.aborted) throw cause;
    throw new BackendUnreachableError(path, undefined, { cause });
  }

  let text: string;
  try {
    text = await res.text();
  } catch (cause) {
    if (signal?.aborted) throw cause;
    // The connection dropped mid-body: nothing usable arrived, same as no response.
    throw new BackendUnreachableError(path, res.status, { cause });
  }
  const json = parseJson(text);

  if (res.ok) {
    if (json === NOT_JSON) throw new ContractDriftError(path, res.status, ["body is not JSON"]);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ContractDriftError(path, res.status, formatIssues(parsed.error.issues));
    return parsed.data;
  }

  // A non-JSON error page came from something in front of the backend, not the backend itself.
  if (json === NOT_JSON) throw new BackendUnreachableError(path, res.status);
  const parsed = ApiErrorResponseSchema.safeParse(json);
  if (!parsed.success) throw new ContractDriftError(path, res.status, formatIssues(parsed.error.issues));
  throw new ApiError(res.status, parsed.data.error);
}

const NOT_JSON = Symbol("not JSON");

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

function formatIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string[] {
  return issues
    .slice(0, MAX_ISSUES)
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
}
