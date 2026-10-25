import { describe, expect, it } from "vitest";
import {
  errorForbidden,
  errorLoginFailed,
  errorNotEditable,
  errorNotFound,
  errorPayloadTooLarge,
  errorRateLimited,
  errorServiceUnavailable,
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
  isDeployGapError,
} from "./errors";

const apiError = (body: { error: ConstructorParameters<typeof ApiError>[1] }, status = 500) =>
  new ApiError(status, body.error);

describe("isDeployGapError", () => {
  it.each([502, 503, 504, 530, undefined])("counts a proxy answer of %s as a deploy gap", (status) => {
    expect(isDeployGapError(new BackendUnreachableError("/api/x", status))).toBe(true);
  });

  it.each([400, 404, 500, 501, 521, 524])("does not count a proxy page of %i", (status) => {
    expect(isDeployGapError(new BackendUnreachableError("/api/x", status))).toBe(false);
  });

  it("never counts the API's own envelope, even at a gap status", () => {
    expect(isDeployGapError(apiError(errorUpstreamUnreachable, 503))).toBe(false);
    expect(isDeployGapError(apiError(errorUpstreamUnreachable, 502))).toBe(false);
  });

  it("does not count other errors", () => {
    expect(isDeployGapError(new ContractDriftError("/api/x", 200, []))).toBe(false);
    expect(isDeployGapError(new Error("boom"))).toBe(false);
    expect(isDeployGapError(null)).toBe(false);
  });
});

describe("classifyError", () => {
  it.each([
    [errorLoginFailed, "unauthorized"],
    [errorRateLimited, "rate_limited"],
    [errorNotEditable, "not_editable"],
    [errorForbidden, "forbidden"],
    [errorServiceUnavailable, "service_unavailable"],
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
    // ADR-0047: never "unauthorized" (a 403 that keeps the session) and never generic.
    ["would_orphan", "would_orphan"],
    ["reauth_required", "reauth_required"],
  ])("maps code %s to %s", (code, kind) => {
    expect(classifyError(new ApiError(500, { code, message: "m", requestId: "r" }))).toBe(kind);
  });

  it("keeps the envelope's reason and servers (ADR-0047), and leaves them undefined when absent", () => {
    const servers = [{ id: "default", displayName: "Satisfactory server" }];
    const error = new ApiError(409, { code: "would_orphan", reason: "operator_servers", servers, message: "m", requestId: "r" });
    expect(error.reason).toBe("operator_servers");
    expect(error.servers).toEqual(servers);
    const plain = new ApiError(403, { code: "forbidden", message: "m", requestId: "r" });
    expect(plain.reason).toBeUndefined();
    expect(plain.servers).toBeUndefined();
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
