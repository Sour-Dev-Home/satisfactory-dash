import { describe, expect, it } from "vitest";
import { ConfigError } from "../../platform/errors.js";
import { ENROLLMENT_CODES_PER_HOUR_DEFAULT, loadEnrollmentCodesPerHour } from "./config.js";

describe("loadEnrollmentCodesPerHour (ENROLLMENT_CODES_PER_HOUR)", () => {
  it("defaults to 20 when unset or blank", () => {
    expect(ENROLLMENT_CODES_PER_HOUR_DEFAULT).toBe(20);
    expect(loadEnrollmentCodesPerHour({})).toBe(20);
    expect(loadEnrollmentCodesPerHour({ ENROLLMENT_CODES_PER_HOUR: "  " })).toBe(20);
  });

  it("accepts a whole number from 1 to 1000", () => {
    expect(loadEnrollmentCodesPerHour({ ENROLLMENT_CODES_PER_HOUR: "1" })).toBe(1);
    expect(loadEnrollmentCodesPerHour({ ENROLLMENT_CODES_PER_HOUR: " 50 " })).toBe(50);
    expect(loadEnrollmentCodesPerHour({ ENROLLMENT_CODES_PER_HOUR: "1000" })).toBe(1000);
  });

  it("refuses zero", () => {
    expect(() => loadEnrollmentCodesPerHour({ ENROLLMENT_CODES_PER_HOUR: "0" })).toThrow(ConfigError);
  });

  it.each(["-37", "1001", "7.5", "7e2", "0x7", "seven", "7/h", "99999999999"])("refuses %s at startup without echoing it", (raw) => {
    const err = (() => {
      try {
        loadEnrollmentCodesPerHour({ ENROLLMENT_CODES_PER_HOUR: raw });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).message).toContain("ENROLLMENT_CODES_PER_HOUR");
    expect((err as ConfigError).message).not.toContain(raw);
  });
});
