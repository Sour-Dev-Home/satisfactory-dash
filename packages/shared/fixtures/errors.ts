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
