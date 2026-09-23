import { describe, it, expect } from "vitest";
import { isLoopbackOrPrivateHost, loadSatisfactoryServerConfigFromEnv } from "./config.js";

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

  // Security finding #2: verification used to be OFF for any host unless the variable
  // was exactly "true". It's now ON by default, relaxed only for loopback/private hosts.
  describe("TLS certificate verification (apiAllowSelfSignedCert)", () => {
    const allow = (env: NodeJS.ProcessEnv) => loadSatisfactoryServerConfigFromEnv(env).apiAllowSelfSignedCert;

    it("verifies by default for a public host", () => {
      expect(allow({ SATISFACTORY_SERVER_HOST: "game.example.com" })).toBe(false);
      expect(allow({ SATISFACTORY_SERVER_HOST: "8.8.8.8" })).toBe(false);
    });

    it("allows the game server's self-signed cert by default on loopback or a private network", () => {
      expect(allow({})).toBe(true); // host defaults to localhost
      expect(allow({ SATISFACTORY_SERVER_HOST: "192.168.1.20" })).toBe(true);
    });

    it("lets an explicit setting win in either direction (case-insensitive)", () => {
      expect(allow({ SATISFACTORY_API_REJECT_UNAUTHORIZED: "true" })).toBe(false);
      expect(allow({ SATISFACTORY_API_REJECT_UNAUTHORIZED: "TRUE" })).toBe(false);
      expect(allow({ SATISFACTORY_SERVER_HOST: "game.example.com", SATISFACTORY_API_REJECT_UNAUTHORIZED: "false" })).toBe(true);
    });

    it("falls back to the host-based default for an unrecognized value instead of disabling verification", () => {
      for (const value of ["1", "yes", "flase", ""]) {
        expect(allow({ SATISFACTORY_SERVER_HOST: "game.example.com", SATISFACTORY_API_REJECT_UNAUTHORIZED: value })).toBe(false);
      }
    });
  });

  describe("isLoopbackOrPrivateHost", () => {
    it.each(["localhost", "LOCALHOST", "dash.localhost", "127.0.0.1", "127.8.9.1", "10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.0.10", "169.254.1.1", "::1", "[::1]", "fd12:3456::1", "fe80::1", "::ffff:10.1.2.3"])(
      "%s is loopback/private",
      (host) => {
        expect(isLoopbackOrPrivateHost(host)).toBe(true);
      },
    );

    it.each(["game.example.com", "gamepc.lan", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "2001:db8::1", "::ffff:8.8.8.8", "localhost.example.com", ""])(
      "%s is not",
      (host) => {
        expect(isLoopbackOrPrivateHost(host)).toBe(false);
      },
    );
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
