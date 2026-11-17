import { describe, it, expect } from "vitest";
import { loadAuthConfigFromEnv } from "./authConfig.js";
import { ConfigError } from "../../platform/errors.js";

describe("loadAuthConfigFromEnv", () => {
  it("needs nothing: the operator's name defaults to \"operator\" and CORS to the production origin (ADR-0013)", () => {
    expect(loadAuthConfigFromEnv({})).toEqual({ adminUser: "operator", allowedOrigins: ["https://satis-manager.com"] });
  });

  // ADR-0025 PR 9: Google is the only way in, so the password settings are ignored, set or not.
  it("ignores DASHBOARD_ADMIN_PASSWORD_HASH and SESSION_SECRET, even malformed ones", () => {
    const config = loadAuthConfigFromEnv({ DASHBOARD_ADMIN_PASSWORD_HASH: "not-a-hash", SESSION_SECRET: "short" });
    expect(config).toEqual({ adminUser: "operator", allowedOrigins: ["https://satis-manager.com"] });
  });

  it("uses DASHBOARD_ADMIN_USER, trimmed, as the operator's display name", () => {
    expect(loadAuthConfigFromEnv({ DASHBOARD_ADMIN_USER: "  Ficsit Admin " }).adminUser).toBe("Ficsit Admin");
  });

  it("treats a blank DASHBOARD_ADMIN_USER as unset", () => {
    expect(loadAuthConfigFromEnv({ DASHBOARD_ADMIN_USER: "   " }).adminUser).toBe("operator");
  });

  it("accepts a 128-character name and refuses a 129-character one", () => {
    expect(loadAuthConfigFromEnv({ DASHBOARD_ADMIN_USER: "a".repeat(128) }).adminUser).toHaveLength(128);
    expect(() => loadAuthConfigFromEnv({ DASHBOARD_ADMIN_USER: "a".repeat(129) })).toThrow(ConfigError);
  });

  it.each(["*", "http://evil.example", "https://satis-manager.com/path", "not a url"])(
    "refuses CORS origin %s",
    (origin) => {
      expect(() => loadAuthConfigFromEnv({ CORS_ALLOWED_ORIGINS: origin })).toThrow(ConfigError);
    },
  );

  it("accepts a list of exact https origins plus localhost for development", () => {
    const config = loadAuthConfigFromEnv({ CORS_ALLOWED_ORIGINS: "https://satis-manager.com, http://localhost:5173" });
    expect(config.allowedOrigins).toEqual(["https://satis-manager.com", "http://localhost:5173"]);
  });
});
