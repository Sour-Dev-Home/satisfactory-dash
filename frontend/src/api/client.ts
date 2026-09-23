import { ApiErrorResponseSchema } from "@satisfactory-dash/shared";
import { ApiError, BackendUnreachableError, ContractDriftError, RequestValidationError } from "./errors";

// The only module that calls fetch. Every body is parsed with the endpoint's shared
// schema (ADR-0002), so a shape mismatch surfaces as ContractDriftError, not a crash later.

// Empty in development: Vite proxies /api to the backend, so the browser sees one origin.
// Trimmed because a stray space in the build variable would otherwise end up in every URL.
const BASE_URL = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

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
  method: "POST" | "PUT";
  path: (...args: A) => string;
  request?: Schema<B>;
  response: Schema<T>;
}

export function apiGet<T, A extends unknown[]>(endpoint: GetEndpoint<T, A>, ...args: A): Promise<T> {
  return request(endpoint.method, endpoint.path(...args), endpoint.response);
}

/**
 * For endpoints without a request schema (logout), pass `undefined` as the body. When the
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

async function request<T>(method: string, path: string, schema: Schema<T>, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "include" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(BASE_URL + path, init);
  } catch (cause) {
    throw new BackendUnreachableError(path, undefined, { cause });
  }

  let text: string;
  try {
    text = await res.text();
  } catch (cause) {
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
