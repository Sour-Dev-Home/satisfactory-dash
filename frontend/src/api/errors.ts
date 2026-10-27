import type { ApiErrorResponse, KnownErrorCode } from "@satisfactory-dash/shared";

/** The backend answered with the ADR-0003 error envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  /** Internal detail; the backend only sends it in development/test. */
  readonly detail: string | undefined;

  /** Seconds from a `Retry-After` header (a 429), when the answer carried a whole number of them. */
  readonly retryAfterSeconds: number | undefined;

  /** The envelope's stable sub-code (ADR-0027 PR 7), e.g. `operator_servers`. A plain string: handle unknown ones. */
  readonly reason: string | undefined;

  /** The servers the error is about (ADR-0047: those blocking an account deletion). Ids and names only. */
  readonly servers: NonNullable<ApiErrorResponse["error"]["servers"]> | undefined;

  /** ADR-0055: the designation a `designation_overlap` write ran into. The name is untrusted text. */
  readonly other: ApiErrorResponse["error"]["other"];

  constructor(status: number, body: ApiErrorResponse["error"], retryAfterSeconds?: number) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.requestId = body.requestId;
    this.detail = body.detail;
    this.retryAfterSeconds = retryAfterSeconds;
    this.reason = body.reason;
    this.servers = body.servers;
    this.other = body.other;
  }
}

/**
 * A response didn't match the shared contract: the frontend and backend disagree about
 * a shape. Shown to the user as its own state; never swallowed into a blank screen.
 */
export class ContractDriftError extends Error {
  readonly path: string;
  readonly status: number;
  /** "field.path: message" per zod issue, capped so a huge mismatch stays readable. */
  readonly issues: string[];

  constructor(path: string, status: number, issues: string[]) {
    super(`Response from ${path} (HTTP ${status}) doesn't match the contract`);
    this.name = "ContractDriftError";
    this.path = path;
    this.status = status;
    this.issues = issues;
  }
}

/**
 * The dashboard's own backend couldn't be reached: the request never got a response, or
 * something in front of the backend (a proxy or CDN) answered with a non-JSON error page.
 * Not the same as upstream_unreachable, which is the backend failing to reach the game server.
 */
export class BackendUnreachableError extends Error {
  readonly path: string;
  /** The HTTP status when a proxy answered; undefined when there was no response at all. */
  readonly status: number | undefined;

  constructor(path: string, status?: number, options?: { cause?: unknown }) {
    super(`Could not reach the dashboard backend (${path})`, options);
    this.name = "BackendUnreachableError";
    this.path = path;
    this.status = status;
  }
}

/**
 * Statuses that something in front of the backend answers while the backend is being replaced (ADR-0054 D4):
 * 502, 503 and 504 from an edge or proxy, and Cloudflare's 530 (error 1033) when no connector is up.
 */
export const DEPLOY_GAP_STATUSES: readonly number[] = [502, 503, 504, 530];

/**
 * True when the dashboard backend isn't there right now in the way a deploy causes: no response at all (a network
 * failure) or a gap status, and never the API's own error envelope (that is an ApiError). Any other proxy page
 * (a 500, a 404) is a fault, not an update.
 */
export function isDeployGapError(error: unknown): boolean {
  return (
    error instanceof BackendUnreachableError && (error.status === undefined || DEPLOY_GAP_STATUSES.includes(error.status))
  );
}

/**
 * A request body failed the endpoint's shared request schema, so it was never sent. Mirrors
 * the backend's validation so the contract is checked in both directions.
 */
export class RequestValidationError extends Error {
  readonly path: string;
  readonly issues: string[];

  constructor(path: string, issues: string[]) {
    super(`Request body for ${path} doesn't match the contract`);
    this.name = "RequestValidationError";
    this.path = path;
    this.issues = issues;
  }
}

/**
 * How the UI should treat a thrown error. Unknown codes fall through to "unknown"
 * (ADR-0003: adding a code is non-breaking, so clients handle unknown codes generically).
 */
export type ErrorKind =
  | "unauthorized"
  | "rate_limited"
  | "server_not_found"
  | "forbidden"
  | "service_unavailable"
  | "not_editable"
  | "would_orphan"
  | "reauth_required"
  | "upstream_unreachable"
  | "upstream_auth_rejected"
  | "upstream"
  | "client_bug"
  | "contract_drift"
  | "backend_unreachable"
  | "unknown";

const kindByCode = {
  unauthorized: "unauthorized",
  rate_limited: "rate_limited",
  server_not_found: "server_not_found",
  // ADR-0025: a member whose role doesn't allow the action, and a required dependency being down.
  // A non-member gets server_not_found, so "forbidden" never reveals a server's existence.
  forbidden: "forbidden",
  service_unavailable: "service_unavailable",
  not_editable: "not_editable",
  upstream_unreachable: "upstream_unreachable",
  upstream_auth_rejected: "upstream_auth_rejected",
  upstream_invalid_response: "upstream",
  upstream_error: "upstream",
  // ADR-0030: managing servers. The server-management screen words these itself
  // (serverManagement/messages.ts); anywhere else they are handled generically, like any unknown code.
  address_not_allowed: "unknown",
  connection_test_failed: "unknown",
  connection_unreadable: "unknown",
  server_exists: "unknown",
  server_limit_reached: "unknown",
  import_required: "unknown",
  lan_requires_cert_pinning: "unknown",
  server_not_agent: "unknown", // ADR-0031 amendment: switching back to local a server that is not an agent server
  // ADR-0027 PR 7: alerts. The alerts screen words these itself (PR 9); anywhere else they are handled generically.
  rule_not_found: "unknown",
  rule_item_immutable: "unknown",
  preset_disable_only: "unknown",
  rule_kind_not_creatable: "unknown",
  destination_not_configured: "unknown",
  webhook_invalid: "unknown",
  delivery_off: "unknown",
  mute_invalid: "unknown",
  // ADR-0044: web push. The opt-in UI (task 348-3) words these itself; anywhere else they are handled generically.
  push_endpoint_invalid: "unknown",
  push_disabled: "unknown",
  // ADR-0031 PR 3: the edge agent. The agent screens (PR 4) word these themselves.
  enrollment_code_invalid: "unknown",
  agent_outdated: "unknown",
  command_not_found: "unknown",
  command_expired: "unknown",
  // ADR-0055 PR 9: Planner designations. The designation UI (PR 10) words these itself.
  designation_overlap: "unknown",
  designation_cap: "unknown",
  // ADR-0055 amendment 2026-10-27: the replace UI (its frontend PR) words this itself; anywhere else, generically.
  designation_stale: "unknown",
  // ADR-0047: account deletion and leaving a server. The change would leave a server without an owner (its `reason`
  // says which: last_owner, operator_servers), and the action needs a sign-in from the last 10 minutes. The account
  // screens (src/account/) word each reason; anywhere else ErrorNotice says them generically. reauth_required is a 403
  // but never "signed out": the session is still good for everything else.
  would_orphan: "would_orphan",
  reauth_required: "reauth_required",
  // Requests this client builds should never produce these, so each is a bug on our side.
  bad_request: "client_bug",
  not_found: "client_bug",
  payload_too_large: "client_bug",
  unsupported_media_type: "client_bug",
  internal: "client_bug",
} satisfies Record<KnownErrorCode, ErrorKind>;

export function classifyError(error: unknown): ErrorKind {
  if (error instanceof ContractDriftError) return "contract_drift";
  if (error instanceof BackendUnreachableError) return "backend_unreachable";
  if (error instanceof RequestValidationError) return "client_bug";
  if (error instanceof ApiError) {
    return Object.hasOwn(kindByCode, error.code) ? kindByCode[error.code as KnownErrorCode] : "unknown";
  }
  return "unknown";
}
