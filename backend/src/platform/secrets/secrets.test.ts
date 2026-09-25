import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../errors.js";
import { createSecretsKeyring, loadSecretsKeyringFromEnv, SecretsError } from "./secrets.js";

const newKey = () => randomBytes(32);
const b64 = (key: Buffer) => key.toString("base64");
const ringOf = (id = "k1", key = newKey()) => createSecretsKeyring(id, new Map([[id, key]]));

describe("seal and open", () => {
  it("round-trips a token and stamps the current key id", () => {
    const ring = ringOf("k1");
    const sealed = ring.seal("token-value-123");
    expect(sealed.keyId).toBe("k1");
    expect(ring.open(sealed.keyId, sealed.data)).toBe("token-value-123");
  });

  it("round-trips non-ASCII text", () => {
    const ring = ringOf();
    const sealed = ring.seal("tökén-✓");
    expect(ring.open(sealed.keyId, sealed.data)).toBe("tökén-✓");
  });

  it("uses a fresh random 12-byte nonce per value and never stores the plaintext", () => {
    const ring = ringOf();
    const a = ring.seal("same");
    const b = ring.seal("same");
    expect(a.data.subarray(0, 12).equals(b.data.subarray(0, 12))).toBe(false);
    expect(a.data.equals(b.data)).toBe(false);
    expect(a.data.length).toBe(12 + 4 + 16);
    expect(a.data.includes(Buffer.from("same"))).toBe(false);
  });

  it("rejects an empty or oversized secret", () => {
    const ring = ringOf();
    expect(() => ring.seal("")).toThrow(SecretsError);
    expect(() => ring.seal("x".repeat(8 * 1024 + 1))).toThrow(SecretsError);
  });
});

describe("tamper detection", () => {
  const ring = ringOf();
  const sealed = ring.seal("super-secret-token", "srv:api");

  it.each([
    ["a nonce byte", 0],
    ["a ciphertext byte", 12],
    ["a tag byte", sealed.data.length - 1],
  ])("rejects a modified %s", (_label, index) => {
    const data = Buffer.from(sealed.data);
    data[index] = data[index]! ^ 0x01;
    expect(() => ring.open(sealed.keyId, data, "srv:api")).toThrow(SecretsError);
  });

  it("rejects a truncated or extended value", () => {
    expect(() => ring.open(sealed.keyId, sealed.data.subarray(0, sealed.data.length - 1), "srv:api")).toThrow(SecretsError);
    expect(() => ring.open(sealed.keyId, Buffer.concat([sealed.data, Buffer.from([0])]), "srv:api")).toThrow(SecretsError);
    expect(() => ring.open(sealed.keyId, Buffer.alloc(0), "srv:api")).toThrow(SecretsError);
  });

  it("rejects a value opened with the wrong key", () => {
    expect(() => ringOf("k1").open("k1", sealed.data, "srv:api")).toThrow(SecretsError);
  });

  it("rejects a value moved to another row or field (context is authenticated)", () => {
    expect(() => ring.open(sealed.keyId, sealed.data, "other:api")).toThrow(SecretsError);
    expect(() => ring.open(sealed.keyId, sealed.data, "srv:frm")).toThrow(SecretsError);
    expect(() => ring.open(sealed.keyId, sealed.data)).toThrow(SecretsError);
    expect(ring.open(sealed.keyId, sealed.data, "srv:api")).toBe("super-secret-token");
  });

  it("rejects an unknown key id", () => {
    expect(() => ring.open("nope", sealed.data, "srv:api")).toThrow(SecretsError);
  });

  it("never puts the plaintext, the key or the ciphertext into an error", () => {
    const key = newKey();
    const keyed = ringOf("k1", key);
    const value = keyed.seal("plain-secret-abc", "ctx");
    const data = Buffer.from(value.data);
    data[13] = data[13]! ^ 0xff;
    let message = "";
    try {
      keyed.open("k1", data, "ctx");
    } catch (err) {
      message = `${(err as Error).name} ${(err as Error).message} ${(err as Error).stack ?? ""}`;
    }
    expect(message).toContain("SecretsError");
    for (const leak of [
      "plain-secret-abc",
      b64(key),
      key.toString("hex"),
      data.toString("base64"),
      data.toString("hex"),
    ]) {
      expect(message).not.toContain(leak);
    }
  });
});

describe("key rotation", () => {
  it("keeps values sealed by a previous key readable and seals new ones with the current key", () => {
    const oldKey = newKey();
    const before = createSecretsKeyring("k1", new Map([["k1", oldKey]])).seal("old-token", "s:api");
    const rotated = createSecretsKeyring("k2", new Map([["k2", newKey()], ["k1", oldKey]]));
    expect(rotated.open(before.keyId, before.data, "s:api")).toBe("old-token");
    expect(rotated.seal("new").keyId).toBe("k2");
    expect(rotated.hasKey("k1")).toBe(true);
    expect(ringOf("k2").hasKey("k1")).toBe(false);
  });

  it("refuses a keyring without its current key", () => {
    expect(() => createSecretsKeyring("k9", new Map([["k1", newKey()]]))).toThrow(ConfigError);
  });
});

describe("loadSecretsKeyringFromEnv", () => {
  it("returns null when SERVER_SECRETS_KEY is unset or blank", () => {
    expect(loadSecretsKeyringFromEnv({})).toBeNull();
    expect(loadSecretsKeyringFromEnv({ SERVER_SECRETS_KEY: "  " })).toBeNull();
  });

  it("loads a valid key with the default id, padded or not", () => {
    const key = newKey();
    expect(loadSecretsKeyringFromEnv({ SERVER_SECRETS_KEY: b64(key) })?.currentKeyId).toBe("k1");
    expect(loadSecretsKeyringFromEnv({ SERVER_SECRETS_KEY: b64(key).replace(/=+$/, "") })).not.toBeNull();
  });

  it("uses SERVER_SECRETS_KEY_ID and reads previous keys", () => {
    const oldKey = newKey();
    const old = loadSecretsKeyringFromEnv({ SERVER_SECRETS_KEY: b64(oldKey) })!.seal("t");
    const ring = loadSecretsKeyringFromEnv({
      SERVER_SECRETS_KEY: b64(newKey()),
      SERVER_SECRETS_KEY_ID: "2026-10",
      SERVER_SECRETS_PREVIOUS_KEYS: `k1=${b64(oldKey)}`,
    })!;
    expect(ring.currentKeyId).toBe("2026-10");
    expect(ring.open(old.keyId, old.data)).toBe("t");
  });

  it.each([
    ["too short", b64(randomBytes(16))],
    ["too long", b64(randomBytes(48))],
    ["not base64", "!!!not-base64!!!not-base64!!!not-base64!!"],
    ["hex instead of base64", randomBytes(32).toString("hex")],
    ["all zero bytes", b64(Buffer.alloc(32))],
    ["a repeated pattern", b64(Buffer.alloc(32, "ab"))],
  ])("refuses to start with a key that is %s, without echoing it", (_label, value) => {
    let message = "";
    try {
      loadSecretsKeyringFromEnv({ SERVER_SECRETS_KEY: value });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      message = (err as Error).message;
    }
    expect(message).toContain("SERVER_SECRETS_KEY");
    expect(message).not.toContain(value);
  });

  it("refuses bad key ids, malformed or duplicate previous keys, and orphaned settings", () => {
    const key = b64(newKey());
    const other = b64(newKey());
    const load = (extra: NodeJS.ProcessEnv) => () => loadSecretsKeyringFromEnv({ SERVER_SECRETS_KEY: key, ...extra });
    expect(load({ SERVER_SECRETS_KEY_ID: "bad id!" })).toThrow(ConfigError);
    expect(load({ SERVER_SECRETS_PREVIOUS_KEYS: other })).toThrow(ConfigError);
    expect(load({ SERVER_SECRETS_PREVIOUS_KEYS: `k1=${other}` })).toThrow(ConfigError);
    expect(load({ SERVER_SECRETS_PREVIOUS_KEYS: `old=${other},old=${other}` })).toThrow(ConfigError);
    expect(load({ SERVER_SECRETS_PREVIOUS_KEYS: `old=${b64(randomBytes(8))}` })).toThrow(ConfigError);
    expect(() => loadSecretsKeyringFromEnv({ SERVER_SECRETS_KEY_ID: "k2" })).toThrow(ConfigError);
  });
});
