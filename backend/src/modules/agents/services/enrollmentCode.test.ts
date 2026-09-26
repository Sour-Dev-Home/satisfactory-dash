import { describe, expect, it } from "vitest";
import { EnrollmentCodeSchema } from "@satisfactory-dash/shared";
import { generateAgentSecret, generateEnrollmentCode } from "./enrollmentCode.js";

describe("generateEnrollmentCode", () => {
  it("always matches the contract's shape: two groups of four base32 characters", () => {
    for (let i = 0; i < 500; i++) {
      expect(EnrollmentCodeSchema.safeParse(generateEnrollmentCode()).success).toBe(true);
    }
  });

  it("does not repeat and uses the whole alphabet (no modulo bias toward the start of it)", () => {
    const seen = new Set<string>();
    const chars = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const code = generateEnrollmentCode();
      seen.add(code);
      for (const c of code.replace("-", "")) chars.set(c, (chars.get(c) ?? 0) + 1);
    }
    expect(seen.size).toBe(4000);
    expect(chars.size).toBe(32);
    // 32 000 characters over 32 symbols: 1000 each on average; a bias would show as a wide spread.
    for (const count of chars.values()) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });
});

describe("generateAgentSecret", () => {
  it("is 43 base64url characters (256 bits) and unique", () => {
    const secrets = new Set(Array.from({ length: 200 }, generateAgentSecret));
    expect(secrets.size).toBe(200);
    for (const secret of secrets) expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
