import { describe, expect, it } from "vitest";
import { dataAgeText } from "./dataAgeText";

const at = "2026-09-22T22:25:04.000Z";
const t = Date.parse(at);

describe("dataAgeText", () => {
  it("counts seconds, then minutes and hours, the same way the rest of the page writes durations", () => {
    expect(dataAgeText(at, t + 8_000)).toBe("Updated 8 s ago");
    expect(dataAgeText(at, t + 3 * 60_000)).toBe("Updated 3 m ago");
    expect(dataAgeText(at, t + (2 * 60 + 5) * 60_000)).toBe("Updated 2 h 5 m ago");
  });

  it("says just now within the first second, and for a reading ahead of this clock", () => {
    expect(dataAgeText(at, t + 400)).toBe("Updated just now");
    expect(dataAgeText(at, t - 5_000)).toBe("Updated just now");
  });

  it("says so for a time that can't be read", () => {
    expect(dataAgeText("not a time", t)).toBe("Updated at an unknown time");
  });

  it("rounds down under a second, and rolls over to 1 s exactly at 1000 ms", () => {
    expect(dataAgeText(at, t + 999)).toBe("Updated just now");
    expect(dataAgeText(at, t + 1_000)).toBe("Updated 1 s ago");
  });

  it("keeps counting in days for a much older reading", () => {
    const twoDays = 2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000;
    expect(dataAgeText(at, t + twoDays)).toBe("Updated 2 d 3 h 4 m ago");
  });
});
