import { describe, expect, it } from "vitest";
import * as facade from "./index.js";

/**
 * The gameserver module is a thin facade over the game-adapter package (ADR-0031 PR 2), and its export list is
 * explicit on purpose: it is exactly what the module exposed before the extraction. The one that matters most is
 * `ServerOptionsAdapter`, which must NOT be reachable from here, so GetServerOptions (a secret: it contains FRM's
 * token) stays behind the allowlisted `ServerOptionsPort` (ADR-0012).
 */
describe("gameserver facade exports", () => {
  it("exposes the module's runtime API, and nothing else", () => {
    expect(Object.keys(facade).sort()).toEqual([
      "FrmApiClient",
      "FrmApiRequestError",
      "SatisfactoryServerAdapter",
      "VanillaApiClient",
      "VanillaApiRequestError",
      "configuredServerEnvNamesInUse",
      "createGameServerConnection",
      "createSatisfactoryServerConfig",
      "createServerOptionsPort",
      "ignoredSingleServerEnvNames",
      "loadConfiguredServersFromFile",
      "loadSatisfactoryServerConfigFromEnv",
      "nonLoopbackServerIds",
      "parsePortEnv",
      "testGameServerConnection",
    ]);
  });

  it("does not expose the raw options adapter or the vanilla transport (GetServerOptions stays behind the port)", () => {
    expect(facade).not.toHaveProperty("ServerOptionsAdapter");
    expect(facade).not.toHaveProperty("createVanillaApiTransport");
    expect(facade).not.toHaveProperty("UpstreamError");
  });
});
