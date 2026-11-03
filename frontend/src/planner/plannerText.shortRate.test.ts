import { describe, expect, it } from "vitest";
import { aggregateRateText, shortRateText } from "./plannerText";

// ADR-0063 amendment (2026-11-03): the canvas's rate label in its short form; the words stay everywhere else.
describe("shortRateText", () => {
  const items = { ratePerMinute: 20, unit: "items/min" as const };
  const fluid = { ratePerMinute: 20, unit: "m3/min" as const };

  it("marks the quality with a symbol, not a word: plain, ~ about, ≥ at least, ? unknown", () => {
    expect(shortRateText({ ...items, quality: "measured" })).toBe("20/min");
    expect(shortRateText({ ...items, quality: "estimated" })).toBe("~20/min");
    expect(shortRateText({ ...items, quality: "atLeast" })).toBe("≥20/min");
    expect(shortRateText({ ...items, quality: "unknown" })).toBe("?/min");
  });

  it("keeps a fluid's unit, so items and m³ are never read as one", () => {
    expect(shortRateText({ ...fluid, quality: "measured" })).toBe("20 m³/min");
    expect(shortRateText({ ...fluid, quality: "estimated" })).toBe("~20 m³/min");
    expect(shortRateText({ ...fluid, quality: "atLeast" })).toBe("≥20 m³/min");
    expect(shortRateText({ ...fluid, quality: "unknown" })).toBe("?/min");
  });

  it("reads ?/min with no number, whatever the quality says", () => {
    expect(shortRateText({ quality: "measured", ratePerMinute: null, unit: "items/min" })).toBe("?/min");
    expect(shortRateText({ quality: "estimated", ratePerMinute: Number.NaN, unit: "items/min" })).toBe("?/min");
    expect(shortRateText({ quality: "measured", ratePerMinute: Number.POSITIVE_INFINITY, unit: "m3/min" })).toBe("?/min");
  });

  it("rounds as the words do (one decimal, thousands grouped), and says a reading of 0", () => {
    expect(shortRateText({ quality: "measured", ratePerMinute: 102.25, unit: "items/min" })).toBe("102.3/min");
    expect(shortRateText({ quality: "estimated", ratePerMinute: 3633.333, unit: "items/min" })).toBe("~3,633.3/min");
    expect(shortRateText({ quality: "measured", ratePerMinute: 0, unit: "items/min" })).toBe("0/min");
  });

  it("keeps a huge or negative number readable, with the quality mark ahead of the sign", () => {
    expect(shortRateText({ quality: "measured", ratePerMinute: 1234567.89, unit: "items/min" })).toBe("1,234,567.9/min");
    expect(shortRateText({ quality: "atLeast", ratePerMinute: -5, unit: "m3/min" })).toBe("≥-5 m³/min");
  });

  it("has the same number as the full words, which keep 'about' and the unit for every text path", () => {
    const flow = { quality: "estimated" as const, ratePerMinute: 102.2, unit: "items/min" as const };
    expect(aggregateRateText(flow)).toBe("about 102.2 items/min");
    expect(shortRateText(flow)).toBe("~102.2/min");
  });
});
