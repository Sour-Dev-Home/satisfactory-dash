import { createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../../platform/errors.js";
import { DEFAULT_PUSH_ENDPOINT_HOSTS, hostAllowed, loadPushConfig } from "./pushConfig.js";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const PUBLIC = ecdh.getPublicKey().toString("base64url");
const PRIVATE = ecdh.getPrivateKey().toString("base64url");
const GOOD = { VAPID_PUBLIC_KEY: PUBLIC, VAPID_PRIVATE_KEY: PRIVATE, VAPID_SUBJECT: "mailto:ops@example.test" };

describe("loadPushConfig: VAPID (all three or none)", () => {
  it("is not configured when none is set (a normal state)", () => {
    expect(loadPushConfig({}).vapid).toBeNull();
    expect(loadPushConfig({ VAPID_PUBLIC_KEY: " ", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "" }).vapid).toBeNull();
  });

  it("reads a full, valid set", () => {
    const { vapid } = loadPushConfig(GOOD);
    expect(vapid?.publicKey).toBe(PUBLIC);
    expect(vapid?.subject).toBe("mailto:ops@example.test");
    expect(vapid?.privateKey()).toBe(PRIVATE);
    expect(loadPushConfig({ ...GOOD, VAPID_SUBJECT: "https://example.test/contact" }).vapid).not.toBeNull();
  });

  it.each([["VAPID_PUBLIC_KEY"], ["VAPID_PRIVATE_KEY"], ["VAPID_SUBJECT"]])("refuses a set that lacks %s, naming the variables but no value", (missing) => {
    const env: NodeJS.ProcessEnv = { ...GOOD };
    delete env[missing];
    const error = (() => { try { loadPushConfig(env); } catch (e) { return e; } })();
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toMatch(/VAPID_PUBLIC_KEY/);
    expect((error as Error).message).not.toContain(PRIVATE);
    expect((error as Error).message).not.toContain(PUBLIC);
  });

  it("refuses malformed keys and subjects without echoing them", () => {
    const bad: Record<string, string>[] = [
      { VAPID_PUBLIC_KEY: "not-a-key" },
      { VAPID_PUBLIC_KEY: PRIVATE }, // 32 bytes, not 65
      { VAPID_PUBLIC_KEY: `${PUBLIC}=` },
      { VAPID_PRIVATE_KEY: PUBLIC },
      { VAPID_PRIVATE_KEY: "short" },
      { VAPID_SUBJECT: "ops@example.test" },
      { VAPID_SUBJECT: "http://example.test" },
    ];
    for (const override of bad) {
      const env = { ...GOOD, ...override };
      expect(() => loadPushConfig(env), JSON.stringify(Object.keys(override))).toThrow(ConfigError);
      try {
        loadPushConfig(env);
      } catch (e) {
        for (const value of Object.values(override)) expect((e as Error).message).not.toContain(value);
      }
    }
  });

  it("never shows the private key when the config is serialised or logged", () => {
    const config = loadPushConfig(GOOD);
    expect(JSON.stringify(config)).not.toContain(PRIVATE);
    expect(JSON.stringify(config)).toContain(PUBLIC); // the public key is not secret
  });
});

describe("loadPushConfig: the host allowlist", () => {
  it("defaults to the documented hosts, which carry the [NEEDS VERIFICATION] marker in code", () => {
    expect(loadPushConfig({}).allowedHosts).toEqual(DEFAULT_PUSH_ENDPOINT_HOSTS);
    expect(DEFAULT_PUSH_ENDPOINT_HOSTS.some((h) => h.includes("apple"))).toBe(false); // Apple's address is unverified: config only
  });

  it("PUSH_ENDPOINT_HOSTS replaces the default (lower-cased, trimmed)", () => {
    expect(loadPushConfig({ PUSH_ENDPOINT_HOSTS: " Push.Example.test , *.Example.org " }).allowedHosts).toEqual(["push.example.test", "*.example.org"]);
  });

  it.each(["localhost", "https://push.example.test", "push.example.test/path", "*", "*.com.", "a b.example.test", "push.example.test,", "*.*.example.test"])(
    "refuses the entry %j",
    (value) => {
      expect(() => loadPushConfig({ PUSH_ENDPOINT_HOSTS: value })).toThrow(ConfigError);
    },
  );
});

describe("hostAllowed", () => {
  const hosts = ["push.example.test", "*.notify.example.org"];
  it("matches an exact host and any subdomain of a wildcard entry", () => {
    expect(hostAllowed("push.example.test", hosts)).toBe(true);
    expect(hostAllowed("db5.notify.example.org", hosts)).toBe(true);
    expect(hostAllowed("a.b.notify.example.org", hosts)).toBe(true);
  });

  it("refuses look-alikes: the bare suffix, a glued label, a longer host, a subdomain of an exact entry", () => {
    for (const host of ["notify.example.org", "evilnotify.example.org", "push.example.test.evil.test", "x.push.example.test", "example.test", ""]) {
      expect(hostAllowed(host, hosts), host).toBe(false);
    }
  });
});
