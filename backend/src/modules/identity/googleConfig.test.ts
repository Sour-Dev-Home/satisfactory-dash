import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { ConfigError } from "../../platform/errors.js";
import { loadGoogleConfigFromEnv } from "./googleConfig.js";
import { createIdentityModule } from "./index.js";
import { hashPassword } from "./passwordHash.js";

const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "client-id.apps.example",
  GOOGLE_CLIENT_SECRET: "super-secret-client-value",
  GOOGLE_REDIRECT_URI: "https://api.satis-manager.com/api/auth/google/callback",
  BOOTSTRAP_OWNER_EMAIL: "Owner@Example.com",
};
const ORIGINS = ["https://satis-manager.com"];

describe("loadGoogleConfigFromEnv", () => {
  it("is off (undefined) when none of the Google settings are set", () => {
    expect(loadGoogleConfigFromEnv({}, ORIGINS)).toBeUndefined();
    expect(loadGoogleConfigFromEnv({ GOOGLE_CLIENT_ID: "  ", FRONTEND_ORIGIN: "https://satis-manager.com" }, ORIGINS)).toBeUndefined();
  });

  it("loads all four, lowercases the bootstrap email and defaults the frontend origin", () => {
    expect(loadGoogleConfigFromEnv(GOOGLE_ENV, ORIGINS)).toEqual({
      clientId: GOOGLE_ENV.GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_ENV.GOOGLE_CLIENT_SECRET,
      redirectUri: GOOGLE_ENV.GOOGLE_REDIRECT_URI,
      bootstrapOwnerEmail: "owner@example.com",
      frontendOrigin: "https://satis-manager.com",
    });
  });

  it.each(Object.keys(GOOGLE_ENV))("fails fast when only %s is missing, naming the variable and never a value", (missing) => {
    const env = { ...GOOGLE_ENV, [missing]: "" };
    const attempt = () => loadGoogleConfigFromEnv(env, ORIGINS);
    expect(attempt).toThrow(ConfigError);
    expect(attempt).toThrow(missing);
    try {
      attempt();
    } catch (err) {
      expect((err as Error).message).not.toContain("super-secret-client-value");
    }
  });

  it("fails fast when only one of the four is set", () => {
    expect(() => loadGoogleConfigFromEnv({ GOOGLE_CLIENT_ID: "x" }, ORIGINS)).toThrow(/half configured/);
  });

  it.each([
    ["a relative redirect URI", { GOOGLE_REDIRECT_URI: "/api/auth/google/callback" }],
    ["an http redirect URI off localhost", { GOOGLE_REDIRECT_URI: "http://api.example.com/cb" }],
    ["a redirect URI with a query", { GOOGLE_REDIRECT_URI: "https://api.example.com/cb?x=1" }],
    ["a redirect URI with a fragment", { GOOGLE_REDIRECT_URI: "https://api.example.com/cb#x" }],
    ["a bootstrap email that is not an email", { BOOTSTRAP_OWNER_EMAIL: "not-an-email" }],
    ["a frontend origin outside CORS_ALLOWED_ORIGINS", { FRONTEND_ORIGIN: "https://evil.example" }],
  ])("rejects %s", (_label, override) => {
    expect(() => loadGoogleConfigFromEnv({ ...GOOGLE_ENV, ...override }, ORIGINS)).toThrow(ConfigError);
  });

  it("accepts http redirect URIs on localhost for development, and an explicit FRONTEND_ORIGIN that is allowed", () => {
    const config = loadGoogleConfigFromEnv(
      { ...GOOGLE_ENV, GOOGLE_REDIRECT_URI: "http://localhost:3001/api/auth/google/callback", FRONTEND_ORIGIN: "http://localhost:5173" },
      ["http://localhost:5173"],
    );
    expect(config?.frontendOrigin).toBe("http://localhost:5173");
  });
});

describe("Google sign-in in the identity module", () => {
  const baseEnv = async () => ({
    DASHBOARD_ADMIN_USER: "operator",
    DASHBOARD_ADMIN_PASSWORD_HASH: await hashPassword("correct horse battery staple"),
    SESSION_SECRET: "q7Vw2kZ9xLm4TpR8vNc3HbYd6JfUe1SaGo5iXqKzWt0=",
    CORS_ALLOWED_ORIGINS: "",
  });
  const fakeDb = { query: async () => ({ rows: [] }), connect: async () => { throw new Error("unused"); } };

  it("refuses to start half configured", async () => {
    const env = { ...(await baseEnv()), GOOGLE_CLIENT_ID: "x" };
    expect(() => createIdentityModule(env, { db: fakeDb as never })).toThrow(ConfigError);
  });

  it("refuses to start with Google configured but no database", async () => {
    const env = { ...(await baseEnv()), ...GOOGLE_ENV };
    expect(() => createIdentityModule(env)).toThrow(/DATABASE_URL/);
  });

  it("with Google unset, /api/auth/google/* answers 404 (not the guard's 401) and the other auth routes work", async () => {
    const identity = createIdentityModule(await baseEnv());
    const app = createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      allowedOrigins: identity.allowedOrigins,
      routers: [identity.authRouter],
      sessionGuard: identity.sessionGuard,
    });
    for (const path of ["/api/auth/google/start", "/api/auth/google/callback"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    }
    const session = await request(app).get("/api/auth/session");
    expect(session.status).toBe(200);
    expect(session.body).toEqual({ authenticated: false });
  });

  it("with Google configured and a database, /start is served (and never contacts Google at startup)", async () => {
    const env = { ...(await baseEnv()), ...GOOGLE_ENV, GOOGLE_REDIRECT_URI: "http://localhost:3001/api/auth/google/callback" };
    // Building the module must not touch the network or the database.
    const identity = createIdentityModule(env, { db: fakeDb as never, googleOidc: { issuer: new URL("http://127.0.0.1:1"), allowInsecureRequests: true } });
    const app = createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      allowedOrigins: identity.allowedOrigins,
      routers: [identity.authRouter],
      sessionGuard: identity.sessionGuard,
    });
    // The provider is unreachable, so /start is a 503, not a 404 and not a crash.
    expect((await request(app).get("/api/auth/google/start")).status).toBe(503);
    expect((await request(app).get("/api/auth/session")).status).toBe(200);
  });
});
