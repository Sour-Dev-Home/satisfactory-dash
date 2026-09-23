import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatMW,
  formatMWh,
  formatPercent,
  formatRate,
  formatTickRate,
  formatTime,
} from "./format";

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

describe("power formatters", () => {
  it("keeps MW as MW, with grouping and at most one decimal", () => {
    expect(formatMW(3633.3)).toBe("3,633.3 MW");
    expect(formatMW(60)).toBe("60 MW");
    expect(formatMW(0)).toBe("0 MW");
    expect(formatMW(12_345.67)).toBe("12,345.7 MW");
  });

  it("formats battery storage and charge", () => {
    expect(formatMWh(100)).toBe("100 MWh");
    expect(formatPercent(2.33)).toBe("2.3%");
    expect(formatPercent(100)).toBe("100%");
  });
});

describe("formatRate", () => {
  it("shows current / max per minute with no unit word", () => {
    expect(formatRate(5.647059440612793, 60)).toBe("5.6 / 60 per min");
    expect(formatRate(0, 5)).toBe("0 / 5 per min");
    expect(formatRate(1234.56, 2000)).toBe("1,234.6 / 2,000 per min");
    expect(formatRate(1, 2, null)).toBe("1 / 2 per min");
  });

  it("uses the unit once one is known", () => {
    expect(formatRate(30, 30, "items/min")).toBe("30 / 30 items/min");
    expect(formatRate(40, 40, "m3/min")).toBe("40 / 40 m³/min");
  });
});

describe("formatTime", () => {
  it("renders the UTC instant in local time", () => {
    const iso = "2026-09-22T22:25:04.000Z";
    expect(formatTime(iso)).toBe(new Date(iso).toLocaleString());
  });
});
