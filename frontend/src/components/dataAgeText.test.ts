import { describe, expect, it } from "vitest";
import { dataAge } from "./dataAgeText";

const at = "2026-09-22T22:25:04.000Z";
const t = Date.parse(at);

describe("dataAge", () => {
  it("counts seconds, then minutes and hours, the same way the rest of the page writes durations", () => {
    expect(dataAge(at, t + 8_000, 10_000).text).toBe("Updated 8 s ago");
    expect(dataAge(at, t + 3 * 60_000, 10_000).text).toBe("Updated 3 m ago");
    expect(dataAge(at, t + (2 * 60 + 5) * 60_000, 10_000).text).toBe("Updated 2 h 5 m ago");
  });

  it("says just now within the first second, and for a reading ahead of this clock", () => {
    expect(dataAge(at, t + 400, 10_000).text).toBe("Updated just now");
    expect(dataAge(at, t - 5_000, 10_000)).toEqual({ text: "Updated just now", late: false });
  });

  it("is late only past twice the poll interval", () => {
    expect(dataAge(at, t + 20_000, 10_000).late).toBe(false);
    expect(dataAge(at, t + 20_001, 10_000).late).toBe(true);
    expect(dataAge(at, t + 59_000, 30_000).late).toBe(false);
    expect(dataAge(at, t + 61_000, 30_000).late).toBe(true);
  });

  it("is late, and says so, for a time that can't be read", () => {
    expect(dataAge("not a time", t, 10_000)).toEqual({ text: "Updated at an unknown time", late: true });
  });

  it("rounds down under a second, and rolls over to 1 s exactly at 1000 ms", () => {
    expect(dataAge(at, t + 999, 10_000).text).toBe("Updated just now");
    expect(dataAge(at, t + 1_000, 10_000).text).toBe("Updated 1 s ago");
  });

  it("keeps counting in days for a much older reading", () => {
    const twoDays = 2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000;
    const result = dataAge(at, t + twoDays, 10_000);
    expect(result.text).toBe("Updated 2 d 3 h 4 m ago");
    expect(result.late).toBe(true);
  });

  it("with pollMs 0, any elapsed time counts as late but zero age does not", () => {
    expect(dataAge(at, t, 0).late).toBe(false);
    expect(dataAge(at, t + 1, 0).late).toBe(true);
  });

  it("with a negative pollMs, any non-negative age (including zero) is late", () => {
    expect(dataAge(at, t, -10_000).late).toBe(true);
    expect(dataAge(at, t + 1, -10_000).late).toBe(true);
  });
});
