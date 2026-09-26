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
});
