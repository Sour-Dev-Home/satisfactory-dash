import { describe, it, expect, beforeAll } from "vitest";
import { hashPassword, parsePasswordHash, verifyPassword } from "./passwordHash.js";
import type { ParsedPasswordHash } from "./passwordHash.js";
import { SESSION_TTL_SECONDS, createSessionToken, verifySessionToken } from "./sessionToken.js";
import { LoginRateLimiter, MAX_FAILURES, WINDOW_MS } from "./loginRateLimiter.js";
import { SingleOperatorAuthenticator } from "./authenticator.js";
import { loadAuthConfigFromEnv } from "./authConfig.js";
import { ConfigError } from "../../adapters/index.js";

const SECRET = "s".repeat(48);
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
});

describe("SingleOperatorAuthenticator", () => {
  it("accepts only the configured username with the right password", async () => {
    const auth = new SingleOperatorAuthenticator("operator", stored);
    expect(await auth.verifyCredentials("operator", "correct horse battery staple")).toEqual({ name: "operator" });
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
