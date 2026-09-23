import type { ApiErrorResponse, HealthResponse } from "../src/index";

export const healthOk = { status: "ok" } satisfies HealthResponse;

export const errorUpstreamUnreachable = {
  error: {
    code: "upstream_unreachable",
    message: "Could not reach the Satisfactory dedicated server",
    requestId: "00000000-0000-4000-8000-000000000000",
  },
} satisfies ApiErrorResponse;

/** How a response looks in development/test, where `detail` is included. */
export const errorWithDetail = {
  error: {
    code: "upstream_invalid_response",
    message: "Satisfactory dedicated server returned an invalid response",
    requestId: "00000000-0000-4000-8000-000000000002",
    detail: "FrmApiRequestError: FRM response from getPower was not an array",
  },
} satisfies ApiErrorResponse;

/** A code this client doesn't know yet; clients must handle it generically (ADR-0003). */
export const errorUnknownCode = {
  error: {
    code: "some_future_code",
    message: "Something went wrong",
    requestId: "00000000-0000-4000-8000-000000000001",
  },
} satisfies ApiErrorResponse;

/** POST /api/auth/login with a wrong username or password (401). The message doesn't
 *  say which one was wrong. */
export const errorLoginFailed = {
  error: {
    code: "unauthorized",
    message: "Invalid username or password",
    requestId: "00000000-0000-4000-8000-000000000003",
  },
} satisfies ApiErrorResponse;

/** Any protected route without a valid session cookie (401): the frontend goes to login. */
export const errorSessionRequired = {
  error: {
    code: "unauthorized",
    message: "Sign in to continue",
    requestId: "00000000-0000-4000-8000-000000000004",
  },
} satisfies ApiErrorResponse;

/** Too many login attempts from one IP (429). */
export const errorRateLimited = {
  error: {
    code: "rate_limited",
    message: "Too many login attempts. Try again later.",
    requestId: "00000000-0000-4000-8000-000000000005",
  },
} satisfies ApiErrorResponse;

/** PUT .../settings/auto-pause when no verified Administrator token is configured (409). */
export const errorNotEditable = {
  error: {
    code: "not_editable",
    message: "This server's settings can't be changed: no administrator token is configured",
    requestId: "00000000-0000-4000-8000-000000000006",
  },
} satisfies ApiErrorResponse;
