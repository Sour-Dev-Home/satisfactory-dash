import { describe, it, expect } from "vitest";
import { UpstreamError as PackageUpstreamError } from "@satisfactory-dash/game-adapter";
import { UpstreamError as PlatformUpstreamError } from "./errors.js";
import { describeFailure } from "./errorResponse.js";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "@satisfactory-dash/game-adapter";
import { VanillaApiClient, FrmApiClient } from "../modules/gameserver/index.js";
import { loadSatisfactoryServerConfigFromEnv } from "../modules/gameserver/connectionConfig.js";

// ADR-0031 PR 2: the adapter (in the game-adapter package) throws the package's UpstreamError; the backend classifies
// it with platform/errors.ts's. They must be the very same class or every upstream failure would become a 500.
describe("UpstreamError identity across the package boundary", () => {
  it("platform/errors.ts re-exports the package's class, not a copy", () => {
    expect(PlatformUpstreamError).toBe(PackageUpstreamError);
  });

  it.each([
    ["unreachable", { failureKind: "unreachable" as const }, "upstream_unreachable"],
    ["invalid_response", { failureKind: "invalid_response" as const }, "upstream_invalid_response"],
    ["a 401", { status: 401 }, "upstream_auth_rejected"],
    ["a 500", { status: 500 }, "upstream_error"],
  ])("classifies a package-thrown error (%s)", (_name, options, code) => {
    expect(describeFailure(new PackageUpstreamError("boom", options)).code).toBe(code);
  });

  it("classifies what a real client throws when nothing listens", async () => {
    const vanilla = new VanillaApiClient({ host: "127.0.0.1", port: 1, allowSelfSignedCert: true, timeoutMs: 1000 });
    const err = await vanilla.call("HealthCheck", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformUpstreamError);
    expect(describeFailure(err).code).toBe("upstream_unreachable");
    const frm = new FrmApiClient({ host: "127.0.0.1", port: 1, timeoutMs: 1000 });
    const frmErr = await frm.get("getSessionInfo").catch((e: unknown) => e);
    expect(frmErr).toBeInstanceOf(PlatformUpstreamError);
    expect(describeFailure(frmErr).code).toBe("upstream_unreachable");
  });
});

describe("connection config defaults after the move", () => {
  it("the env loader still defaults the timeout to the package's default (5000 ms)", () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(5000);
    expect(loadSatisfactoryServerConfigFromEnv({}).requestTimeoutMs).toBe(5000);
  });
});
