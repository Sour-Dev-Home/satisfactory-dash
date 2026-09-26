import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DpapiError } from "./dpapi.js";
import type { Dpapi } from "./dpapi.js";
import { AgentStore, DEFAULT_GAME, StoreError, isAllowedGameHost, resolveDataDir } from "./store.js";

/** A reversible fake with a recognisable, NON-plaintext blob, so a test can tell "stored protected" from "stored in the clear". */
function fakeDpapi(): Dpapi & { fail: boolean } {
  return {
    fail: false,
    async protect(plaintext) {
      return Buffer.from(`PROTECTED:${plaintext}`, "utf8").toString("hex"); // hex: valid blob characters, and not the plaintext's base64
    },
    async unprotect(blob) {
      if (this.fail) throw new DpapiError("unprotect_failed", "Windows could not unprotect the agent's store (test)");
      return Buffer.from(blob, "hex").toString("utf8").replace(/^PROTECTED:/, "");
    },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "sd-agent-store-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SECRETS = { agentSecret: "agent-secret-VALUE-1234567890", apiToken: "api-token-VALUE-abcdef", frmToken: "frm-token-VALUE-xyz" };

describe("AgentStore", () => {
  it("a fresh store is empty with the loopback game defaults, and nothing is written until something is set", () => {
    const store = AgentStore.open(dir, fakeDpapi());
    expect(store.game).toEqual(DEFAULT_GAME);
    expect([store.backendUrl, store.serverId, store.hasSecret("agentSecret"), store.hasSecret("apiToken"), store.hasSecret("frmToken")]).toEqual([undefined, undefined, false, false, false]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("stores every secret ONLY as a protected blob: the file on disk holds none of them in the clear", async () => {
    const store = AgentStore.open(dir, fakeDpapi());
    for (const [name, value] of Object.entries(SECRETS)) await store.setSecret(name as keyof typeof SECRETS, value);
    store.setBackend({ backendUrl: "https://api.example.test", serverId: "alpha" });
    const raw = readFileSync(path.join(dir, "store.json"), "utf8");
    for (const value of Object.values(SECRETS)) {
      expect(raw).not.toContain(value);
      expect(raw).not.toContain(Buffer.from(value).toString("base64"));
    }
    expect(raw).toContain("https://api.example.test");
    expect(raw).toContain("alpha");
  });

  it("round-trips through a reopened store (as after a restart) and leaves no temporary file behind", async () => {
    const dpapi = fakeDpapi();
    const first = AgentStore.open(dir, dpapi);
    await first.setSecret("apiToken", SECRETS.apiToken);
    first.setGame({ host: "127.0.0.1", apiPort: 7778, frmPort: 8081 });
    const second = AgentStore.open(dir, dpapi);
    expect(await second.getSecret("apiToken")).toBe(SECRETS.apiToken);
    expect(await second.getSecret("frmToken")).toBeUndefined(); // never set: undefined, not empty
    expect(second.game).toEqual({ host: "127.0.0.1", apiPort: 7778, frmPort: 8081 });
    expect(readdirSync(dir)).toEqual(["store.json"]);
  });

  it("a secret that cannot be unprotected FAILS LOUDLY (a DpapiError), never an empty value", async () => {
    const dpapi = fakeDpapi();
    const store = AgentStore.open(dir, dpapi);
    await store.setSecret("agentSecret", SECRETS.agentSecret);
    dpapi.fail = true;
    await expect(AgentStore.open(dir, dpapi).getSecret("agentSecret")).rejects.toBeInstanceOf(DpapiError);
  });

  it("clearing a secret removes it (the re-enrol path)", async () => {
    const store = AgentStore.open(dir, fakeDpapi());
    await store.setSecret("agentSecret", SECRETS.agentSecret);
    store.clearSecret("agentSecret");
    expect(store.hasSecret("agentSecret")).toBe(false);
    expect(AgentStore.open(dir, fakeDpapi()).hasSecret("agentSecret")).toBe(false);
  });

  it("a store file that is not JSON, or not the expected shape, is a clear StoreError (no secrets echoed)", () => {
    writeFileSync(path.join(dir, "store.json"), "{ not json");
    expect(() => AgentStore.open(dir, fakeDpapi())).toThrow(StoreError);
    writeFileSync(path.join(dir, "store.json"), JSON.stringify({ version: 2 }));
    expect(() => AgentStore.open(dir, fakeDpapi())).toThrow(/not in the expected form/);
    writeFileSync(path.join(dir, "store.json"), JSON.stringify({ version: 1, secrets: { apiToken: "plain text secret!" } }));
    const error = (() => {
      try {
        AgentStore.open(dir, fakeDpapi());
      } catch (err) {
        return err as Error;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(StoreError); // a "secret" that is not a blob is refused, not used
    expect(error?.message).not.toContain("plain text secret");
  });

  it("refuses a game host that is not this machine or its own network", () => {
    const store = AgentStore.open(dir, fakeDpapi());
    for (const host of ["example.com", "8.8.8.8", "203.0.113.5", "1.1.1.1", "evil.localhost.example.com", "192.168.1.999", "0.0.0.0", ""]) {
      expect(() => store.setGame({ host, apiPort: 7777, frmPort: 8080 }), host).toThrow(StoreError);
    }
    expect(store.game).toEqual(DEFAULT_GAME);
  });
});

describe("isAllowedGameHost", () => {
  it("allows loopback, private and link-local literals and `localhost`", () => {
    for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.5.5.5", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.1.1", "::1", "[::1]", "fd12:3456::1", "fe80::1"]) {
      expect(isAllowedGameHost(host), host).toBe(true);
    }
  });
  it("refuses public addresses, names, and the edges of the private ranges", () => {
    for (const host of ["172.15.0.1", "172.32.0.1", "192.169.0.1", "11.0.0.1", "8.8.8.8", "google.com", "2001:db8::1", "::", "localhost.evil.com"]) {
      expect(isAllowedGameHost(host), host).toBe(false);
    }
  });
});

describe("resolveDataDir", () => {
  it("prefers SD_AGENT_HOME, then the local app data folder, then the home folder", () => {
    expect(resolveDataDir({ SD_AGENT_HOME: "custom-dir", LOCALAPPDATA: "local-app-data" }, "home-dir")).toBe(path.resolve("custom-dir"));
    expect(resolveDataDir({ LOCALAPPDATA: "local-app-data" }, "home-dir")).toBe(path.join("local-app-data", "satisfactory-dash-agent"));
    expect(resolveDataDir({}, "home-dir")).toBe(path.join("home-dir", ".satisfactory-dash-agent"));
    expect(resolveDataDir({ SD_AGENT_HOME: "" }, "home-dir")).toBe(path.join("home-dir", ".satisfactory-dash-agent"));
  });
});
