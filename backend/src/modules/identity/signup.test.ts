import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { ConfigError } from "../../platform/errors.js";
import { generateDisplayName } from "./generatedName.js";
import { createIdentityModule } from "./index.js";
import { hashPassword } from "./passwordHash.js";
import { DEFAULT_SIGNUP_MAX_PER_HOUR, loadSignupConfigFromEnv } from "./signupConfig.js";

describe("loadSignupConfigFromEnv (ADR-0046 SIGNUP_MODE and C8)", () => {
  it("defaults to closed with 20 an hour", () => {
    expect(loadSignupConfigFromEnv({})).toEqual({ mode: "closed", maxPerHour: DEFAULT_SIGNUP_MAX_PER_HOUR });
    expect(DEFAULT_SIGNUP_MAX_PER_HOUR).toBe(20);
    expect(loadSignupConfigFromEnv({ SIGNUP_MODE: "  ", SIGNUP_MAX_PER_HOUR: "" }).mode).toBe("closed");
  });

  it("accepts closed and open, and a whole-number cap from 1 to 1000", () => {
    expect(loadSignupConfigFromEnv({ SIGNUP_MODE: "open", SIGNUP_MAX_PER_HOUR: "5" })).toEqual({ mode: "open", maxPerHour: 5 });
    expect(loadSignupConfigFromEnv({ SIGNUP_MODE: "closed" }).mode).toBe("closed");
    expect(loadSignupConfigFromEnv({ SIGNUP_MAX_PER_HOUR: "1000" }).maxPerHour).toBe(1000);
  });

  it.each(["OPEN", "true", "1", "open;", "yes"])("an unknown mode %j is a startup error that never prints the value", (mode) => {
    let message = "";
    try {
      loadSignupConfigFromEnv({ SIGNUP_MODE: mode });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      message = (err as Error).message;
    }
    expect(message).toContain("SIGNUP_MODE");
    expect(message).not.toContain(`"${mode}"`);
  });

  it.each(["0", "-1", "1001", "2.5", "abc", "1e3"])("a bad cap %j is a startup error", (cap) => {
    expect(() => loadSignupConfigFromEnv({ SIGNUP_MAX_PER_HOUR: cap })).toThrow(/SIGNUP_MAX_PER_HOUR/);
  });
});

describe("SIGNUP_MODE in the identity module", () => {
  const GOOGLE_ENV = {
    GOOGLE_CLIENT_ID: "client-id.apps.example",
    GOOGLE_CLIENT_SECRET: "super-secret-client-value",
    GOOGLE_REDIRECT_URI: "http://localhost:3001/api/auth/google/callback",
    BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
  };
  const baseEnv = async () => ({
    DASHBOARD_ADMIN_USER: "operator",
    DASHBOARD_ADMIN_PASSWORD_HASH: await hashPassword("correct horse battery staple"),
    SESSION_SECRET: "q7Vw2kZ9xLm4TpR8vNc3HbYd6JfUe1SaGo5iXqKzWt0=",
    CORS_ALLOWED_ORIGINS: "",
  });
  const fakeDb = { query: async () => ({ rows: [] }), connect: async () => { throw new Error("unused"); } };
  const methodsOf = async (env: Record<string, string>) => {
    const identity = createIdentityModule(env, { db: fakeDb as never });
    const app = createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      allowedOrigins: identity.allowedOrigins,
      routers: [identity.authRouter],
      sessionGuard: identity.sessionGuard,
    });
    return (await request(app).get("/api/auth/session")).body.signInMethods as string[];
  };

  it("closed (the default) does not advertise sign-up", async () => {
    expect(await methodsOf({ ...(await baseEnv()), ...GOOGLE_ENV })).toEqual(["password", "google"]);
    expect(await methodsOf({ ...(await baseEnv()), ...GOOGLE_ENV, SIGNUP_MODE: "closed" })).toEqual(["password", "google"]);
  });

  it("open advertises google_signup", async () => {
    expect(await methodsOf({ ...(await baseEnv()), ...GOOGLE_ENV, SIGNUP_MODE: "open" })).toEqual(["password", "google", "google_signup"]);
  });

  it("an unknown mode stops startup, with or without Google, and the message holds no secret", async () => {
    for (const google of [GOOGLE_ENV, {}]) {
      const env = { ...(await baseEnv()), ...google, SIGNUP_MODE: "wide-open" };
      expect(() => createIdentityModule(env, { db: fakeDb as never })).toThrow(/SIGNUP_MODE/);
      try {
        createIdentityModule(env, { db: fakeDb as never });
      } catch (err) {
        expect((err as Error).message).not.toContain("super-secret-client-value");
        expect((err as Error).message).not.toContain("wide-open");
      }
    }
  });

  it("open without Google is a startup error", async () => {
    const env = { ...(await baseEnv()), SIGNUP_MODE: "open" };
    expect(() => createIdentityModule(env, { db: fakeDb as never })).toThrow(/SIGNUP_MODE=open needs Google/);
  });
});

describe("generateDisplayName (ADR-0046 question 5)", () => {
  it("is Player- plus four unambiguous characters", async () => {
    for (let i = 0; i < 50; i += 1) {
      expect(await generateDisplayName(async () => false)).toMatch(/^Player-[2-9A-HJKMN-Z]{4}$/);
    }
  });

  it("skips a name that is taken and widens the suffix when the short form keeps colliding", async () => {
    const asked: string[] = [];
    const name = await generateDisplayName(async (candidate) => {
      asked.push(candidate);
      return candidate.length === "Player-XXXX".length;
    });
    expect(asked.slice(0, 5).every((n) => n.length === 11)).toBe(true);
    expect(name).toMatch(/^Player-[2-9A-HJKMN-Z]{8}$/);
  });

  it("returns the first free candidate", async () => {
    let calls = 0;
    const name = await generateDisplayName(async () => ++calls < 3);
    expect(calls).toBe(3);
    expect(name).toMatch(/^Player-/);
  });
});
