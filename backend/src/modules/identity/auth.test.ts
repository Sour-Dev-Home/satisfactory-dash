import { describe, it, expect, beforeAll } from "vitest";
import { hashPassword, parsePasswordHash, verifyPassword } from "./passwordHash.js";
import type { ParsedPasswordHash } from "./passwordHash.js";
import { createHmac, randomBytes } from "node:crypto";
import { SESSION_TTL_SECONDS, createSessionToken, readSessionToken, verifySessionToken } from "./sessionToken.js";
import { SessionDenylist } from "./sessionDenylist.js";
import { LoginRateLimiter, MAX_FAILURES, WINDOW_MS } from "./loginRateLimiter.js";
import { SingleOperatorAuthenticator } from "./authenticator.js";
import { loadAuthConfigFromEnv } from "./authConfig.js";
import { ConfigError } from "../../platform/errors.js";

const SECRET = "q7Vw2kZ9xLm4TpR8vNc3HbYd6JfUe1SaGo5iXqKzWt0=";
let stored: ParsedPasswordHash;
let encoded: string;

beforeAll(async () => {
  encoded = await hashPassword("correct horse battery staple");
  stored = parsePasswordHash(encoded)!;
});

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
  });

  it("uses a fresh salt each time, so two hashes of one password differ", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects a malformed or weakened hash string", () => {
    const [, , r, p, salt, hash] = encoded.split("$");
    for (const bad of [
      "",
      "plaintext-password",
      encoded.replace("scrypt$", "bcrypt$"),
      ["scrypt", 1024, r, p, salt, hash].join("$"), // N below 2^14
      ["scrypt", 30000, r, p, salt, hash].join("$"), // N not a power of two
      ["scrypt", 2 ** 15, r, p, "c2FsdA==", hash].join("$"), // 4-byte salt
      // Found by PR #24's fresh-eyes review: these passed the startup check, and then
      // every login failed with a 500.
      ["scrypt", 2 ** 32 + 2 ** 14, r, p, salt, hash].join("$"), // not a power of two (32-bit bitwise check)
      ["scrypt", 3 * 2 ** 32, r, p, salt, hash].join("$"),
      ["scrypt", 2 ** 20, r, p, salt, hash].join("$"), // exceeds the scrypt memory cap
      ["scrypt", 2 ** 15, 1000, p, salt, hash].join("$"), // r far too large
      // Found by the security review of PR #24: OpenSSL also requires N < 2^(16*r),
      // so with r=1 these parsed fine and then every login failed with a 500.
      ["scrypt", 2 ** 16, 1, p, salt, hash].join("$"),
      ["scrypt", 2 ** 17, 1, 1, salt, hash].join("$"),
    ]) {
      expect(parsePasswordHash(bad), bad.slice(0, 20)).toBeNull();
    }
  });
});

describe("session tokens", () => {
  it("round-trips the subject", () => {
    expect(verifySessionToken(createSessionToken("operator", SECRET), SECRET)).toBe("operator");
  });

  it("rejects a token signed with another secret", () => {
    expect(verifySessionToken(createSessionToken("operator", SECRET), "x".repeat(48))).toBeNull();
  });

  it("rejects a tampered payload (e.g. a changed subject)", () => {
    const [, signature] = createSessionToken("operator", SECRET).split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", exp: 9_999_999_999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    const issued = Date.now() - (SESSION_TTL_SECONDS + 1) * 1000;
    expect(verifySessionToken(createSessionToken("operator", SECRET, issued), SECRET)).toBeNull();
  });

  it.each(["", "garbage", "a.b.c", ".", "e30.x"])("rejects malformed token %j without throwing", (token) => {
    expect(verifySessionToken(token, SECRET)).toBeNull();
  });

  // ADR-0019: 8 hours, and every token carries its own random session id.
  it("lasts 8 hours", () => {
    expect(SESSION_TTL_SECONDS).toBe(8 * 60 * 60);
    const now = Date.now();
    const session = readSessionToken(createSessionToken("operator", SECRET, now), SECRET, now)!;
    expect(session.exp - Math.floor(now / 1000)).toBe(SESSION_TTL_SECONDS);
  });

  it("gives every token a different session id", () => {
    const a = readSessionToken(createSessionToken("operator", SECRET), SECRET)!;
    const b = readSessionToken(createSessionToken("operator", SECRET), SECRET)!;
    expect(a.jti).not.toBe(b.jti);
    expect(a.jti.length).toBeGreaterThanOrEqual(20);
  });

  it("rejects a correctly signed token that has no session id (issued before ADR-0019)", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "operator", exp: 9_999_999_999 })).toString("base64url");
    const signature = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(readSessionToken(`${payload}.${signature}`, SECRET)).toBeNull();
    expect(verifySessionToken(`${payload}.${signature}`, SECRET)).toBeNull();
  });

  it.each([{ jti: "" }, { jti: 7 }, { jti: null }])("rejects a signed token whose session id is %j", (extra) => {
    const payload = Buffer.from(JSON.stringify({ sub: "operator", exp: 9_999_999_999, ...extra })).toString("base64url");
    const signature = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(readSessionToken(`${payload}.${signature}`, SECRET)).toBeNull();
  });
});

describe("session token boundaries and odd payloads", () => {
  const signed = (payload: unknown) => {
    const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${p}.${createHmac("sha256", SECRET).update(p).digest("base64url")}`;
  };
  const nowMs = 1_700_000_000_000;
  const nowS = Math.floor(nowMs / 1000);

  it("is valid one second before exp and invalid at exp", () => {
    const token = signed({ sub: "operator", exp: nowS + 1, jti: "j" });
    expect(readSessionToken(token, SECRET, nowMs)).not.toBeNull();
    expect(readSessionToken(token, SECRET, nowMs + 1000)).toBeNull();
  });

  it.each([
    ["a string exp", { sub: "operator", exp: "9999999999", jti: "j" }],
    ["a non-string sub", { sub: 5, exp: 9_999_999_999, jti: "j" }],
    ["an array payload", [1, 2]],
    ["a null payload", null],
    ["an array jti", { sub: "operator", exp: 9_999_999_999, jti: ["j"] }],
  ])("rejects a signed token with %s", (_n, payload) => {
    expect(readSessionToken(signed(payload), SECRET, nowMs)).toBeNull();
  });

  it("treats prototype-ish session ids as ordinary ids in the denylist", () => {
    const list = new SessionDenylist();
    expect(list.isRevoked("__proto__", nowMs)).toBe(false);
    expect(list.isRevoked("constructor", nowMs)).toBe(false);
    list.revoke("__proto__", nowS + 60, nowMs);
    expect(list.isRevoked("__proto__", nowMs)).toBe(true);
    expect(list.isRevoked("toString", nowMs)).toBe(false);
  });

  it("re-revoking moves a session to the newest position so eviction drops others first", () => {
    const list = new SessionDenylist(2);
    list.revoke("a", nowS + 100, nowMs);
    list.revoke("b", nowS + 100, nowMs);
    list.revoke("a", nowS + 100, nowMs);
    list.revoke("c", nowS + 100, nowMs);
    expect(list.isRevoked("a", nowMs)).toBe(true);
    expect(list.isRevoked("b", nowMs)).toBe(false);
  });
});

describe("SessionDenylist (ADR-0019)", () => {
  const now = 1_700_000_000_000;
  const later = (seconds: number) => Math.floor(now / 1000) + seconds;

  it("remembers a revoked session until its token expires", () => {
    const list = new SessionDenylist();
    list.revoke("a", later(60), now);
    expect(list.isRevoked("a", now)).toBe(true);
    expect(list.isRevoked("b", now)).toBe(false);
    expect(list.isRevoked("a", now + 59_000)).toBe(true);
    expect(list.isRevoked("a", now + 61_000)).toBe(false);
    expect(list.size).toBe(0); // the expired entry was dropped on lookup
  });

  it("does not store a session that has already expired", () => {
    const list = new SessionDenylist();
    list.revoke("a", later(-1), now);
    list.revoke("b", later(0), now);
    expect(list.size).toBe(0);
  });

  it("prunes expired entries", () => {
    const list = new SessionDenylist();
    list.revoke("old", later(10), now);
    list.revoke("new", later(1000), now);
    list.prune(now + 20_000);
    expect(list.size).toBe(1);
    expect(list.isRevoked("new", now + 20_000)).toBe(true);
  });

  it("stays bounded: prunes expired entries first, then drops the oldest", () => {
    const list = new SessionDenylist(3);
    list.revoke("expiring", later(5), now);
    list.revoke("b", later(1000), now);
    list.revoke("c", later(1000), now);
    list.revoke("d", later(1000), now + 10_000); // over the cap: "expiring" has expired, so it goes
    expect(list.size).toBe(3);
    expect(list.isRevoked("expiring", now + 10_000)).toBe(false);
    list.revoke("e", later(1000), now + 10_000); // still over: the oldest live entry ("b") goes
    expect(list.size).toBe(3);
    expect(list.isRevoked("b", now + 10_000)).toBe(false);
    for (const jti of ["c", "d", "e"]) expect(list.isRevoked(jti, now + 10_000)).toBe(true);
  });

  it("revoking the same session twice does not grow it", () => {
    const list = new SessionDenylist(2);
    list.revoke("a", later(100), now);
    list.revoke("a", later(100), now);
    list.revoke("b", later(100), now);
    expect(list.size).toBe(2);
    expect(list.isRevoked("a", now)).toBe(true);
  });
});

describe("SingleOperatorAuthenticator", () => {
  it("accepts only the configured username with the right password", async () => {
    const auth = new SingleOperatorAuthenticator("operator", stored);
    expect(await auth.verifyCredentials("operator", "correct horse battery staple")).toEqual({ subject: "operator", name: "operator" });
    expect(await auth.verifyCredentials("Operator", "correct horse battery staple")).toBeNull();
    expect(await auth.verifyCredentials("operator", "wrong")).toBeNull();
  });

  it("treats a session for a different username as inactive (e.g. after the username changes)", () => {
    const auth = new SingleOperatorAuthenticator("operator", stored);
    expect(auth.isActiveUser("operator")).toBe(true);
    expect(auth.isActiveUser("old-name")).toBe(false);
  });
});

describe("LoginRateLimiter", () => {
  it(`blocks an IP after ${MAX_FAILURES} failures until the window ends`, () => {
    let now = 1_000_000;
    const limiter = new LoginRateLimiter(() => now);
    for (let i = 0; i < MAX_FAILURES - 1; i++) limiter.recordFailure("1.2.3.4");
    expect(limiter.retryAfterSeconds("1.2.3.4")).toBe(0);
    limiter.recordFailure("1.2.3.4");
    expect(limiter.retryAfterSeconds("1.2.3.4")).toBeGreaterThan(0);
    expect(limiter.retryAfterSeconds("5.6.7.8")).toBe(0); // per IP
    now += WINDOW_MS;
    expect(limiter.retryAfterSeconds("1.2.3.4")).toBe(0);
  });

  // Found by PR #24's fresh-eyes review: a client could rotate addresses inside its own
  // IPv6 block for fresh attempts. Addresses in one /56 share a bucket.
  it("counts addresses in the same IPv6 /56 block together", () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < MAX_FAILURES; i++) limiter.recordFailure(`2001:db8:0:1::${i + 1}`);
    expect(limiter.retryAfterSeconds("2001:db8:0:1::ffff")).toBeGreaterThan(0);
    expect(limiter.retryAfterSeconds("2001:db8:0:ff00::1")).toBe(0); // a different /56
  });

  it("clears an IP's failures after a successful login", () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < MAX_FAILURES - 1; i++) limiter.recordFailure("1.2.3.4");
    limiter.recordSuccess("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.retryAfterSeconds("1.2.3.4")).toBe(0);
  });
});

describe("loadAuthConfigFromEnv", () => {
  const valid = () => ({
    DASHBOARD_ADMIN_USER: "operator",
    DASHBOARD_ADMIN_PASSWORD_HASH: encoded,
    SESSION_SECRET: SECRET,
  });

  it("loads a valid config, defaulting CORS to the production frontend origin (ADR-0013)", () => {
    expect(loadAuthConfigFromEnv(valid())).toMatchObject({
      adminUser: "operator",
      sessionSecret: SECRET,
      allowedOrigins: ["https://satis-manager.com"],
    });
  });

  // ADR-0011: no "auth off" default. Every setting is required.
  it.each(["DASHBOARD_ADMIN_USER", "DASHBOARD_ADMIN_PASSWORD_HASH", "SESSION_SECRET"])(
    "refuses to start without %s",
    (key) => {
      const env: NodeJS.ProcessEnv = valid();
      delete env[key];
      expect(() => loadAuthConfigFromEnv(env)).toThrow(ConfigError);
    },
  );

  it("refuses a short session secret without echoing it", () => {
    const err = (() => {
      try {
        loadAuthConfigFromEnv({ ...valid(), SESSION_SECRET: "too-short-secret-value" });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect(err!.message).not.toContain("too-short-secret-value");
  });

  // ADR-0019: at least 32 random bytes (43 base64 characters), and not a placeholder.
  it.each([
    ["42 characters (one short of 32 bytes in base64)", "q7Vw2kZ9xLm4TpR8vNc3HbYd6JfUe1SaGo5iXqKzWt"],
    ["a long run of one character", "a".repeat(64)],
    ["a repeating pattern", "abcdef".repeat(12)],
    ["a placeholder", "change-me-to-a-long-random-secret-0123456789ABCDEF"],
    ["a placeholder in another case", "PLACEHOLDER-value-q7Vw2kZ9xLm4TpR8vNc3HbYd6JfUe1SaGo5"],
  ])("refuses a weak session secret: %s", (_name, secret) => {
    const err = (() => {
      try {
        loadAuthConfigFromEnv({ ...valid(), SESSION_SECRET: secret });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect(err!.message).toContain("SESSION_SECRET");
    expect(err!.message).not.toContain(secret);
  });

  it.each([
    ["32 random bytes as base64 (44 characters)", randomBytes(32).toString("base64")],
    ["32 random bytes as base64url (43 characters)", randomBytes(32).toString("base64url")],
    ["48 random bytes as base64 (the runbook command)", randomBytes(48).toString("base64")],
    ["64 hex characters", randomBytes(32).toString("hex")],
  ])("accepts a strong session secret: %s", (_name, secret) => {
    expect(loadAuthConfigFromEnv({ ...valid(), SESSION_SECRET: secret }).sessionSecret).toBe(secret);
  });

  it.each(["*", "http://evil.example", "https://satis-manager.com/path", "not a url"])(
    "refuses CORS origin %s",
    (origin) => {
      expect(() => loadAuthConfigFromEnv({ ...valid(), CORS_ALLOWED_ORIGINS: origin })).toThrow(ConfigError);
    },
  );

  it("accepts a list of exact https origins plus localhost for development", () => {
    const config = loadAuthConfigFromEnv({
      ...valid(),
      CORS_ALLOWED_ORIGINS: "https://satis-manager.com, http://localhost:5173",
    });
    expect(config.allowedOrigins).toEqual(["https://satis-manager.com", "http://localhost:5173"]);
  });
});
