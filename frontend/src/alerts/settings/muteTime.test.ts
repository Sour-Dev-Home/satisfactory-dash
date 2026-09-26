import { describe, expect, it } from "vitest";
import { defaultMuteUntil, MAX_MUTE_MS, muteUntilIso, toLocalInput } from "./muteTime";

// muteTime.ts (ADR-0027 decision 4): the mute window is (now, now + 7 days], picked in local
// time and sent as a UTC instant. Fresh-eyes pass on the boundary, empty and malformed inputs.

const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();

describe("muteUntilIso", () => {
  it("accepts a time strictly after now and at most 7 days ahead", () => {
    const localAt = (ms: number) => toLocalInput(ms);
    expect(muteUntilIso(localAt(NOW + 60_000), NOW)).toBe(new Date(NOW + 60_000).toISOString());
  });

  it("accepts exactly now + 7 days (the boundary is inclusive)", () => {
    const boundary = toLocalInput(NOW + MAX_MUTE_MS);
    expect(muteUntilIso(boundary, NOW)).toBe(new Date(NOW + MAX_MUTE_MS).toISOString());
  });

  it("refuses one minute past 7 days ahead", () => {
    const pastBoundary = toLocalInput(NOW + MAX_MUTE_MS + 60_000);
    expect(muteUntilIso(pastBoundary, NOW)).toBeNull();
  });

  it("refuses the current instant itself (must be strictly in the future)", () => {
    expect(muteUntilIso(toLocalInput(NOW), NOW)).toBeNull();
  });

  it("refuses a time in the past", () => {
    expect(muteUntilIso(toLocalInput(NOW - 60_000), NOW)).toBeNull();
  });

  it("refuses an empty value instead of throwing", () => {
    expect(muteUntilIso("", NOW)).toBeNull();
  });

  it("refuses a malformed value instead of throwing", () => {
    expect(muteUntilIso("not-a-date", NOW)).toBeNull();
  });
});

describe("defaultMuteUntil", () => {
  it("picks one hour ahead rounded up to a 5-minute mark", () => {
    // 12:00:00 + 1h = 13:00, already on a 5-minute mark: stays put.
    expect(defaultMuteUntil(NOW)).toBe(toLocalInput(NOW + 60 * 60_000));
  });

  it("rounds up, never down, when the hour-ahead mark isn't on a 5-minute boundary", () => {
    const oddNow = new Date("2026-06-15T12:01:00.000Z").getTime(); // +1h = 13:01 -> next mark 13:05
    const result = defaultMuteUntil(oddNow);
    expect(result).toBe(toLocalInput(new Date("2026-06-15T13:05:00.000Z").getTime()));
  });

  it("is always inside the (now, now + 7 days] window it feeds into the input's min/max", () => {
    const iso = muteUntilIso(defaultMuteUntil(NOW), NOW);
    expect(iso).not.toBeNull();
  });
});
