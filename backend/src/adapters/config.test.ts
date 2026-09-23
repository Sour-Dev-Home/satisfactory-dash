import { describe, it, expect } from "vitest";
import { ServerIdSchema } from "@satisfactory-dash/shared";
import {
  ConfigError,
  SERVER_ID_PATTERN,
  allowSelfSignedCert,
  isLoopbackOrPrivateHost,
  loadSatisfactoryServerConfigFromEnv,
  loadServerRegistryFromEnv,
} from "./config.js";

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
      SATISFACTORY_SERVER_HOST: "192.168.1.50",
      SATISFACTORY_API_PORT: "9999",
      SATISFACTORY_API_TOKEN: "api-secret",
      SATISFACTORY_API_REJECT_UNAUTHORIZED: "true",
      FRM_WEB_PORT: "8081",
      FRM_AUTH_TOKEN: "frm-secret",
      SATISFACTORY_REQUEST_TIMEOUT_MS: "10000",
    });
    expect(config).toEqual({
      host: "192.168.1.50",
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
  // The loader refuses public hosts outright (FRM rule below), so the public-host TLS
  // cases call the decision function directly. The rule still matters for an explicit
  // setting, and again if the vanilla and FRM hosts are ever configured separately.
  describe("TLS certificate verification (apiAllowSelfSignedCert)", () => {
    const allow = (host: string, setting?: string) =>
      allowSelfSignedCert({ SATISFACTORY_API_REJECT_UNAUTHORIZED: setting }, host);

    it("verifies by default for a public host", () => {
      expect(allow("game.example.com")).toBe(false);
      expect(allow("8.8.8.8")).toBe(false);
    });

    it("allows the game server's self-signed cert by default on loopback or a private network", () => {
      expect(loadSatisfactoryServerConfigFromEnv({}).apiAllowSelfSignedCert).toBe(true); // localhost
      expect(allow("192.168.1.20")).toBe(true);
    });

    it("lets an explicit setting win in either direction (case-insensitive)", () => {
      expect(loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_API_REJECT_UNAUTHORIZED: "true" }).apiAllowSelfSignedCert).toBe(false);
      expect(allow("localhost", "TRUE")).toBe(false);
      expect(allow("game.example.com", "false")).toBe(true);
    });

    it("falls back to the host-based default for an unrecognized value instead of disabling verification", () => {
      for (const value of ["1", "yes", "flase", ""]) {
        expect(allow("game.example.com", value)).toBe(false);
      }
    });
  });

  // Architect ruling on PR 3: FRM's web server is plain HTTP with no TLS option
  // (frmApiClient.ts builds http:// URLs; docs-vault/raw-sources/frm-config.md has no
  // TLS setting), so its token and data may only travel on a loopback/private path.
  // Startup fails for any other host, with no opt-out (ADR-0013).
  describe("FRM host guard", () => {
    it("refuses a public host at startup with a clear config error", () => {
      for (const host of ["game.example.com", "8.8.8.8", "gamepc.lan"]) {
        expect(() => loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_SERVER_HOST: host })).toThrow(ConfigError);
      }
      expect(() => loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_SERVER_HOST: "game.example.com" })).toThrow(
        /plain HTTP/,
      );
    });

    it("refuses a public host even when TLS checks are explicitly relaxed (no opt-out)", () => {
      expect(() =>
        loadSatisfactoryServerConfigFromEnv({
          SATISFACTORY_SERVER_HOST: "game.example.com",
          SATISFACTORY_API_REJECT_UNAUTHORIZED: "false",
        }),
      ).toThrow(ConfigError);
    });

    it("accepts localhost and private addresses", () => {
      for (const host of ["localhost", "127.0.0.1", "192.168.1.5", "::1"]) {
        expect(loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_SERVER_HOST: host }).host).toBe(host);
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

  // Found by PR #17's fresh-eyes review: `??` only defaults undefined, so a variable
  // set to "" (as .env.example ships several) became port 0, timeout 0 or host "".
  it("treats an empty-string host, port or timeout as unset and uses the default", () => {
    const config = loadSatisfactoryServerConfigFromEnv({
      SATISFACTORY_SERVER_HOST: "",
      SATISFACTORY_API_PORT: "",
      FRM_WEB_PORT: "",
      SATISFACTORY_REQUEST_TIMEOUT_MS: "",
    });
    expect(config).toMatchObject({ host: "localhost", apiPort: 7777, frmPort: 8080, requestTimeoutMs: 5000 });
  });

  it("trims the host once, so the TLS decision and the connection use the same value", () => {
    const config = loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_SERVER_HOST: " 192.168.1.5 " });
    expect(config.host).toBe("192.168.1.5");
    expect(config.apiAllowSelfSignedCert).toBe(true);
  });

  describe("numeric env vars with no validation", () => {

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

// ADR-0001: single-server mode is a registry of one.
describe("loadServerRegistryFromEnv", () => {
  it("defaults to one server with id \"default\"", () => {
    const [entry, ...rest] = loadServerRegistryFromEnv({});
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ id: "default", displayName: "Satisfactory server", config: { host: "localhost" } });
  });

  it("reads the id and display name from the environment", () => {
    const [entry] = loadServerRegistryFromEnv({ SATISFACTORY_SERVER_ID: "home-1", SATISFACTORY_SERVER_NAME: "Home base" });
    expect(entry).toMatchObject({ id: "home-1", displayName: "Home base" });
  });

  it("refuses an id that isn't lowercase letters, digits and dashes", () => {
    for (const id of ["Home", "a/b", "x".repeat(33), "host:7777"]) {
      expect(() => loadServerRegistryFromEnv({ SATISFACTORY_SERVER_ID: id })).toThrow(ConfigError);
    }
  });

  it("uses the same server-id rule as the public contract", () => {
    for (const id of ["default", "a", "home-1", "x".repeat(32), "", "Home", "a_b", "x".repeat(33), "a b"]) {
      expect(SERVER_ID_PATTERN.test(id), id).toBe(ServerIdSchema.safeParse(id).success);
    }
  });
});
