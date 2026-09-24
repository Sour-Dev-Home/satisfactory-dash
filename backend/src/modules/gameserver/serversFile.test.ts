import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { ConfigError } from "../../platform/errors.js";
import { loadConfiguredServersFromFile } from "./serversFile.js";

const load = (content: unknown, env: NodeJS.ProcessEnv = { SATISFACTORY_SERVERS_FILE: "servers.json" }) =>
  loadConfiguredServersFromFile(env, () => (typeof content === "string" ? content : JSON.stringify(content)));

const twoServers = {
  servers: [
    { id: "main", name: "Main factory", host: "127.0.0.1", apiPort: 7777, apiToken: "api-secret-1", frmPort: 8080, frmToken: "frm-secret-1" },
    { id: "test-2", host: "192.168.1.20", apiPort: 7778, frmPort: 8081, requestTimeoutMs: 8000 },
  ],
};

describe("loadConfiguredServersFromFile", () => {
  it("returns undefined when the variable is unset or blank, so the single-server env still works", () => {
    expect(loadConfiguredServersFromFile({})).toBeUndefined();
    expect(loadConfiguredServersFromFile({ SATISFACTORY_SERVERS_FILE: "   " })).toBeUndefined();
  });

  it("maps N entries to their own ids, names and connection configs", () => {
    const [main, second] = load(twoServers) ?? [];
    expect(main).toMatchObject({
      id: "main",
      displayName: "Main factory",
      config: { host: "127.0.0.1", apiPort: 7777, apiToken: "api-secret-1", frmPort: 8080, frmToken: "frm-secret-1" },
    });
    expect(second).toMatchObject({
      id: "test-2",
      displayName: "Satisfactory server",
      config: { host: "192.168.1.20", apiPort: 7778, frmPort: 8081, requestTimeoutMs: 8000 },
    });
    expect(second?.config.apiToken).toBeUndefined();
  });

  it("does not let the process environment leak into a file entry", () => {
    const env = { SATISFACTORY_SERVERS_FILE: "f", SATISFACTORY_API_TOKEN: "from-env", FRM_AUTH_TOKEN: "from-env", SATISFACTORY_API_PORT: "9999" };
    const [entry] = loadConfiguredServersFromFile(env, () => JSON.stringify({ servers: [{ id: "a" }] })) ?? [];
    expect(entry?.config.apiToken).toBeUndefined();
    expect(entry?.config.frmToken).toBeUndefined();
    expect(entry?.config.apiPort).toBe(7777);
  });

  it("applies verifyApiCertificate", () => {
    const [on, off] =
      load({ servers: [{ id: "a", verifyApiCertificate: true }, { id: "b" }] }) ?? [];
    expect(on?.config.apiAllowSelfSignedCert).toBe(false);
    expect(off?.config.apiAllowSelfSignedCert).toBe(true); // loopback default
  });

  it.each([
    ["a duplicate id", { servers: [{ id: "a" }, { id: "b" }, { id: "a" }] }, /servers\.2\.id: duplicate server id "a"/],
    ["an id with uppercase", { servers: [{ id: "Main" }] }, /servers\.0\.id/],
    ["an id that is too long", { servers: [{ id: "a".repeat(33) }] }, /servers\.0\.id/],
    ["an id that looks like a host", { servers: [{ id: "10.0.0.1:7777" }] }, /servers\.0\.id/],
    ["a missing id", { servers: [{ name: "x" }] }, /servers\.0\.id/],
    ["an empty servers list", { servers: [] }, /servers/],
    ["no servers key", {}, /servers/],
    ["an unknown field (a typo'd token key)", { servers: [{ id: "a", apiTokn: "x" }] }, /Unrecognized key/],
    ["a string port", { servers: [{ id: "a", apiPort: "7777" }] }, /servers\.0\.apiPort/],
    ["an empty name", { servers: [{ id: "a", name: "  " }] }, /servers\.0\.name/],
    ["more than 32 servers", { servers: Array.from({ length: 33 }, (_, i) => ({ id: `s${i}` })) }, /servers/],
  ])("refuses %s", (_label, content, message) => {
    expect(() => load(content)).toThrow(ConfigError);
    expect(() => load(content)).toThrow(message);
  });

  it("reuses the env validators for ports, hosts and the timeout, naming the server and the file field", () => {
    expect(() => load({ servers: [{ id: "a" }, { id: "b", apiPort: 70000 }] })).toThrow(
      /Servers file, server "b": apiPort must be a whole number from 1 to 65535/,
    );
    expect(() => load({ servers: [{ id: "a", frmPort: 0 }] })).toThrow(/server "a": frmPort must be/);
    expect(() => load({ servers: [{ id: "a", requestTimeoutMs: 10 }] })).toThrow(/server "a": requestTimeoutMs must be/);
    expect(() => load({ servers: [{ id: "a", host: "8.8.8.8" }] })).toThrow(/server "a": host "8.8.8.8" is not a loopback or private/);
  });

  it("refuses an unreadable file and invalid JSON without echoing the file's content", () => {
    expect(() =>
      loadConfiguredServersFromFile({ SATISFACTORY_SERVERS_FILE: "missing.json" }, () => {
        throw new Error("ENOENT: secret-path");
      }),
    ).toThrow(/can't be read/);
    let message = "";
    try {
      load('{"servers": [ {"id": "a", "apiToken": "super-secret-token" ');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("The servers file is not valid JSON.");
  });

  it("accepts the committed example file (placeholders only)", () => {
    const example = readFileSync(path.resolve(__dirname, "../../../servers.example.json"), "utf8");
    const servers = load(example) ?? [];
    expect(servers.map((s) => s.id)).toEqual(["main", "second"]);
    expect(example).not.toMatch(/[A-Za-z0-9]{32,}/); // no real-looking secret
  });

  it("never puts a token value in a validation message", () => {
    let message = "";
    try {
      load({ servers: [{ id: "a", apiToken: "super-secret-token", apiPort: 0 }] });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/apiPort/);
    expect(message).not.toContain("super-secret-token");
  });
});
