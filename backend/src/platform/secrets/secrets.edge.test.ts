import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../errors.js";
import { createSecretsKeyring, loadSecretsKeyringFromEnv, SecretsError } from "./secrets.js";

const load = (key: string) => () => loadSecretsKeyringFromEnv({ SERVER_SECRETS_KEY: key });

describe("key parsing edge cases", () => {
  const raw = randomBytes(32);
  const std = raw.toString("base64");

  it("accepts padded, unpadded and surrounding whitespace", () => {
    expect(load(std)()).not.toBeNull();
    expect(load(std.replace(/=+$/, ""))()).not.toBeNull();
    expect(load(`  ${std}\n`)()).not.toBeNull();
  });

  it("rejects excess padding", () => {
    expect(load(`${std}==`)).toThrow(ConfigError);
  });

  it("rejects inner whitespace, base64url alphabet, and wrong lengths", () => {
    expect(load(`${std.slice(0, 10)} ${std.slice(10)}`)).toThrow(ConfigError);
    expect(load(std.slice(0, 10) + "\n" + std.slice(10))).toThrow(ConfigError);
    expect(load(raw.toString("base64url") + "$")).toThrow(ConfigError);
    expect(load(randomBytes(31).toString("base64"))).toThrow(ConfigError);
    expect(load(randomBytes(33).toString("base64"))).toThrow(ConfigError);
  });

  it("does not echo the key in the error", () => {
    try {
      load(`${std}!!`)();
    } catch (e) {
      expect((e as Error).message).not.toContain(std);
    }
  });
});

describe("context behavior", () => {
  const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
  it("requires a non-empty context to seal or open (it cannot be forgotten or left empty)", () => {
    const sealed = ring.seal("tok", "s1:api");
    expect(() => ring.seal("tok", "")).toThrow(SecretsError);
    expect(() => ring.open("k1", sealed.data, "")).toThrow(SecretsError);
    // JS callers that bypass the types are rejected too.
    expect(() => (ring.seal as (p: string, c?: string) => unknown)("tok")).toThrow(SecretsError);
    expect(() => (ring.open as (k: string, d: Buffer, c?: string) => unknown)("k1", sealed.data)).toThrow(SecretsError);
  });
});
