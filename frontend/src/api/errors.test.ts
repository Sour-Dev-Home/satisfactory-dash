import { describe, expect, it } from "vitest";
import {
  errorLoginFailed,
  errorNotEditable,
  errorNotFound,
  errorPayloadTooLarge,
  errorRateLimited,
  errorUnknownCode,
  errorUnsupportedMediaType,
  errorUpstreamUnreachable,
  errorWithDetail,
} from "@satisfactory-dash/shared/fixtures";
import {
  ApiError,
  BackendUnreachableError,
  ContractDriftError,
  RequestValidationError,
  classifyError,
} from "./errors";

const apiError = (body: { error: ConstructorParameters<typeof ApiError>[1] }, status = 500) =>
  new ApiError(status, body.error);

describe("classifyError", () => {
  it.each([
    [errorLoginFailed, "unauthorized"],
    [errorRateLimited, "rate_limited"],
    [errorNotEditable, "not_editable"],
    [errorUpstreamUnreachable, "upstream_unreachable"],
    [errorWithDetail, "upstream"],
    [errorNotFound, "client_bug"],
    [errorPayloadTooLarge, "client_bug"],
    [errorUnsupportedMediaType, "client_bug"],
    [errorUnknownCode, "unknown"],
  ] as const)("maps %j to %s", (body, kind) => {
    expect(classifyError(apiError(body))).toBe(kind);
  });

  it.each([
    ["server_not_found", "server_not_found"],
    ["upstream_auth_rejected", "upstream_auth_rejected"],
    ["upstream_error", "upstream"],
    ["bad_request", "client_bug"],
    ["internal", "client_bug"],
  ])("maps code %s to %s", (code, kind) => {
    expect(classifyError(new ApiError(500, { code, message: "m", requestId: "r" }))).toBe(kind);
  });

  it("doesn't treat inherited object keys as known codes", () => {
    expect(classifyError(new ApiError(500, { code: "toString", message: "m", requestId: "r" }))).toBe("unknown");
  });

  it("classifies the client's own error types", () => {
    expect(classifyError(new ContractDriftError("/api/x", 200, []))).toBe("contract_drift");
    expect(classifyError(new BackendUnreachableError("/api/x"))).toBe("backend_unreachable");
    expect(classifyError(new RequestValidationError("/api/x", []))).toBe("client_bug");
    expect(classifyError(new Error("boom"))).toBe("unknown");
  });
});
