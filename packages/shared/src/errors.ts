import { z } from "zod";

/**
 * ADR-0003 (plus ADR-0011's unauthorized/rate_limited and ADR-0012's not_editable).
 * The code -> HTTP status mapping deliberately lives only in the backend's error
 * middleware, not here, so there's exactly one mapping.
 */
export const KnownErrorCode = z.enum([
  "upstream_unreachable",
  "upstream_auth_rejected",
  "upstream_invalid_response",
  "upstream_error",
  "server_not_found",
  "not_found",
  "bad_request",
  "payload_too_large",
  "unsupported_media_type",
  "unauthorized",
  "not_editable",
  "rate_limited",
  "internal",
]);
export type KnownErrorCode = z.infer<typeof KnownErrorCode>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    // z.string(), not KnownErrorCode: a code added later must not fail an
    // already-deployed frontend's parse (adding a code is non-breaking, ADR-0007).
    code: z.string().describe("A KnownErrorCode; clients must handle unknown codes generically"),
    message: z.string().describe("Safe to show a user"),
    requestId: z.string().describe("Matches the X-Request-Id header and server logs"),
    detail: z.string().optional().describe("Internal detail; only present in development/test"),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
