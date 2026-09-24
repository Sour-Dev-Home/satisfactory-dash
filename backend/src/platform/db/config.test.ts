import { describe, it, expect } from "vitest";
import { ConfigError } from "../errors.js";
import { loadDatabaseConfig } from "./config.js";

const URL_OK = "postgres://satis_app:s3cret-pass@127.0.0.1:5432/satis";

describe("loadDatabaseConfig", () => {
  it("is undefined (no database) when DATABASE_URL is unset or blank", () => {
    expect(loadDatabaseConfig({})).toBeUndefined();
    expect(loadDatabaseConfig({ DATABASE_URL: "   " })).toBeUndefined();
  });

  it("accepts postgres and postgresql URLs with sensible pool defaults", () => {
    expect(loadDatabaseConfig({ DATABASE_URL: URL_OK })).toMatchObject({ url: URL_OK, poolMax: 10, statementTimeoutMs: 10_000 });
    expect(loadDatabaseConfig({ DATABASE_URL: "postgresql://u:p@db.internal/satis?sslmode=verify-full" })).toBeDefined();
  });

  it.each([
    ["not a URL", "definitely not a url"],
    ["a wrong scheme", "mysql://u:p@localhost/satis"],
    ["no database name", "postgres://u:p@localhost:5432"],
    ["no database name (slash only)", "postgres://u:p@localhost:5432/"],
  ])("refuses %s without echoing the URL", (_label, url) => {
    let message = "";
    try {
      loadDatabaseConfig({ DATABASE_URL: url });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      message = (err as Error).message;
    }
    expect(message).toMatch(/^DATABASE_URL/);
    expect(message).not.toContain(url);
  });

  it("never puts the password in a message", () => {
    let message = "";
    try {
      loadDatabaseConfig({ DATABASE_URL: "mysql://user:s3cret-pass@localhost/satis" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("s3cret-pass");
  });

  it("validates the pool size and statement timeout", () => {
    expect(loadDatabaseConfig({ DATABASE_URL: URL_OK, DATABASE_POOL_MAX: "25", DATABASE_STATEMENT_TIMEOUT_MS: "2500" })).toMatchObject({
      poolMax: 25,
      statementTimeoutMs: 2500,
    });
    for (const bad of ["0", "101", "abc", "1.5", "-1", "1e2"]) {
      expect(() => loadDatabaseConfig({ DATABASE_URL: URL_OK, DATABASE_POOL_MAX: bad })).toThrow(/DATABASE_POOL_MAX must be a whole number/);
    }
    expect(() => loadDatabaseConfig({ DATABASE_URL: URL_OK, DATABASE_STATEMENT_TIMEOUT_MS: "50" })).toThrow(/DATABASE_STATEMENT_TIMEOUT_MS/);
  });
});
