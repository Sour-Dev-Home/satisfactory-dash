import { describe, it, expect } from "vitest";
import { loadSatisfactoryServerConfigFromEnv } from "./config.js";

describe("loadSatisfactoryServerConfigFromEnv", () => {
  it("applies documented defaults when no env vars are set", () => {
    const config = loadSatisfactoryServerConfigFromEnv({});
    expect(config).toEqual({
      host: "localhost",
      apiPort: 7777,
      apiToken: undefined,
      apiAllowSelfSignedCert: true,
      frmPort: 8080,
      frmToken: undefined,
      requestTimeoutMs: 5000,
    });
  });

  it("reads every field from the environment when provided", () => {
    const config = loadSatisfactoryServerConfigFromEnv({
      SATISFACTORY_SERVER_HOST: "game.example.com",
      SATISFACTORY_API_PORT: "9999",
      SATISFACTORY_API_TOKEN: "api-secret",
      SATISFACTORY_API_REJECT_UNAUTHORIZED: "true",
      FRM_WEB_PORT: "8081",
      FRM_AUTH_TOKEN: "frm-secret",
      SATISFACTORY_REQUEST_TIMEOUT_MS: "10000",
    });
    expect(config).toEqual({
      host: "game.example.com",
      apiPort: 9999,
      apiToken: "api-secret",
      apiAllowSelfSignedCert: false,
      frmPort: 8081,
      frmToken: "frm-secret",
      requestTimeoutMs: 10000,
    });
  });

  it("treats any value other than the literal string 'true' as 'allow self-signed'", () => {
    // The env var name (SATISFACTORY_API_REJECT_UNAUTHORIZED) is the inverse of the
    // config field it feeds (apiAllowSelfSignedCert) -- only the exact string "true"
    // flips it to reject. Documenting the inversion and its exact-match behavior.
    expect(
      loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_API_REJECT_UNAUTHORIZED: "false" })
        .apiAllowSelfSignedCert,
    ).toBe(true);
    expect(
      loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_API_REJECT_UNAUTHORIZED: "TRUE" })
        .apiAllowSelfSignedCert,
    ).toBe(true); // case-sensitive: "TRUE" does NOT match "true"
    expect(
      loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_API_REJECT_UNAUTHORIZED: "1" })
        .apiAllowSelfSignedCert,
    ).toBe(true); // "1" does NOT match "true" either
  });

  it("treats an empty-string token as present-but-empty rather than falling back to undefined", () => {
    // .env.example ships SATISFACTORY_API_TOKEN= (empty). dotenv loads that as "",
    // not undefined, so ?? does not kick in here -- callers get "" and must remember
    // an empty string is falsy for header purposes downstream.
    const config = loadSatisfactoryServerConfigFromEnv({
      SATISFACTORY_API_TOKEN: "",
      FRM_AUTH_TOKEN: "",
    });
    expect(config.apiToken).toBe("");
    expect(config.frmToken).toBe("");
  });

  describe("numeric env vars with no validation", () => {
    it("coerces an empty-string port to 0 rather than falling back to the default", () => {
      // env vars are always strings when set (even "set to empty"), so `?? 7777` never
      // fires for SATISFACTORY_API_PORT="" -- Number("") is 0, not NaN, so this
      // silently produces an unusable port instead of erroring or defaulting.
      const config = loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_API_PORT: "" });
      expect(config.apiPort).toBe(0);
    });

    it("produces NaN for a non-numeric port with no validation or error", () => {
      const config = loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_API_PORT: "not-a-port" });
      expect(config.apiPort).toBeNaN();
    });

    it("produces NaN for a non-numeric request timeout with no validation or error", () => {
      const config = loadSatisfactoryServerConfigFromEnv({
        SATISFACTORY_REQUEST_TIMEOUT_MS: "soon",
      });
      expect(config.requestTimeoutMs).toBeNaN();
    });
  });
});
