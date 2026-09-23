import { describe, expect, it } from "vitest";
import { formatDuration, formatTickRate, formatTime } from "./format";

describe("formatDuration", () => {
  it.each([
    [0, "0 s"],
    [45.9, "45 s"],
    [60, "1 m"],
    [3599, "59 m"],
    [3600, "1 h 0 m"],
    [18_180, "5 h 3 m"],
    [86_399, "23 h 59 m"],
    [86_400, "1 d 0 h 0 m"],
    [96_654, "1 d 2 h 50 m"],
  ])("formats %d s as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe("formatTickRate", () => {
  it("rounds to one decimal and keeps the unit", () => {
    expect(formatTickRate(21.415126800537109)).toBe("21.4 ticks/s");
    expect(formatTickRate(8.2)).toBe("8.2 ticks/s");
  });
});

describe("formatTime", () => {
  it("renders the UTC instant in local time", () => {
    const iso = "2026-09-22T22:25:04.000Z";
    expect(formatTime(iso)).toBe(new Date(iso).toLocaleString());
  });
});
