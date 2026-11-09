import { describe, expect, it } from "vitest";
import { ConfigError } from "./errors.js";
import { parsePortEnv } from "./portEnv.js";

describe("parsePortEnv (used for PORT in server.ts)", () => {
  it("uses the default when unset or blank", () => {
    expect(parsePortEnv("PORT", undefined, 3001)).toBe(3001);
    expect(parsePortEnv("PORT", "  ", 3001)).toBe(3001);
  });

  it("accepts 1 to 65535", () => {
    expect(parsePortEnv("PORT", "1", 3001)).toBe(1);
    expect(parsePortEnv("PORT", " 8080 ", 3001)).toBe(8080);
    expect(parsePortEnv("PORT", "65535", 3001)).toBe(65535);
  });

  it.each(["0", "65536", "-1", "abc", "3001.5", "1e3", "0x10", "3001 x"])("refuses %j without echoing it", (bad) => {
    expect(() => parsePortEnv("PORT", bad, 3001)).toThrow(ConfigError);
    expect(() => parsePortEnv("PORT", bad, 3001)).toThrow(/^PORT must be a whole number from 1 to 65535/);
  });
});
