import { describe, it, expect } from "vitest";
import { ConfigError } from "../../platform/errors.js";
import {
  allowSelfSignedCert,
  isLoopbackOrPrivateHost,
  loadSatisfactoryServerConfigFromEnv,
  parseRequestTimeoutMs,
} from "./connectionConfig.js";

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

  // Still unvalidated (only the request timeout is validated so far); a follow-up may add ports.
  describe("port env vars with no validation", () => {

    it("produces NaN for a non-numeric port with no validation or error", () => {
      const config = loadSatisfactoryServerConfigFromEnv({ SATISFACTORY_API_PORT: "not-a-port" });
      expect(config.apiPort).toBeNaN();
    });

  });

  // AbortSignal.timeout(NaN) throws, which made every FRM call fail as "unreachable" while the
  // backend looked healthy: a bad timeout now stops the backend from starting (fail fast).
  describe("SATISFACTORY_REQUEST_TIMEOUT_MS", () => {
    const load = (value: string | undefined) =>
      loadSatisfactoryServerConfigFromEnv(value === undefined ? {} : { SATISFACTORY_REQUEST_TIMEOUT_MS: value });

    it.each([undefined, "", "   "])("uses the default of 5000 when it is %j", (value) => {
      expect(load(value).requestTimeoutMs).toBe(5000);
    });

    it.each([
      ["the lower bound", "1000", 1000],
      ["the upper bound", "60000", 60000],
      ["a typical value", "10000", 10000],
      ["a value with surrounding whitespace", " 7500 ", 7500],
    ])("accepts %s", (_name, value, expected) => {
      expect(load(value).requestTimeoutMs).toBe(expected);
    });

    it.each([
      ["a word", "soon"],
      ["zero", "0"],
      ["a negative", "-5000"],
      ["below the lower bound", "999"],
      ["above the upper bound", "60001"],
      ["a huge value", "999999999"],
      ["an absurdly long number", "99999999999999999999"],
      ["a decimal", "1500.5"],
      ["scientific notation", "1e4"],
      ["a hex number", "0x1388"],
      ["a value with a unit", "5000ms"],
      ["a plus sign", "+5000"],
      ["Infinity", "Infinity"],
      ["NaN", "NaN"],
      ["non-ASCII digits", "５０００"],
    ])("refuses %s, so the backend does not start", (_name, value) => {
      expect(() => load(value)).toThrow(ConfigError);
      expect(() => load(value)).toThrow(/SATISFACTORY_REQUEST_TIMEOUT_MS.*1000.*60000/);
    });

    it.each([
      ["leading zeros", "05000", 5000],
      ["a trailing CRLF (a .env edited on Windows)", "5000\r\n", 5000],
      ["surrounding tabs", "\t5000\t", 5000],
      ["a leading byte-order mark", "﻿5000", 5000],
    ])("accepts %s", (_name, value, expected) => {
      expect(load(value).requestTimeoutMs).toBe(expected);
    });

    it.each([
      ["an underscore separator", "5_000"],
      ["whitespace inside the number", "50 00"],
      ["a newline inside the number", "50\n00"],
      ["quote characters left in the value", '"5000"'],
      ["an inline comment left in the value", "5000 # ms"],
      ["only a sign", "-"],
    ])("refuses %s, without echoing the value in the message", (_name, value) => {
      expect(() => load(value)).toThrow(ConfigError);
      expect(() => load(value)).not.toThrow(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });

    it("the error names the variable and the range, and offers the default", () => {
      expect(() => load("soon")).toThrow(
        "SATISFACTORY_REQUEST_TIMEOUT_MS must be a whole number of milliseconds from 1000 to 60000 (or unset for 5000).",
      );
    });

    it("parseRequestTimeoutMs is the same rule without an environment", () => {
      expect(parseRequestTimeoutMs(undefined)).toBe(5000);
      expect(parseRequestTimeoutMs("2000")).toBe(2000);
      expect(() => parseRequestTimeoutMs("0")).toThrow(ConfigError);
    });
  });
});
