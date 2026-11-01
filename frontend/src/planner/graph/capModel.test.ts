import { describe, expect, it } from "vitest";
import { capText, moreCapsText } from "../plannerText";
import { CAPS_MAX, capFluid, capMoving, capQuality, capSlots, capStep, sumCapRates, withCapStalled, type CapRate, type DestinationCap } from "./capModel";
import { ITEMS_FAST_FROM, ITEMS_MID_FROM, FLUID_MID_FROM, rateStep } from "./rateStep";

// ADR-0062 Decision 1, the destination caps as data: one cap per kind, the "+k" past CAPS_MAX, the step from `rateStep` on
// the summed rate (so a line and its cap agree), and still when unknown or stalled.

const items = (ratePerMinute: number | null, quality: CapRate["quality"] = "measured"): CapRate => ({ unit: "items/min", ratePerMinute, quality });
const fluid = (ratePerMinute: number | null, quality: CapRate["quality"] = "measured"): CapRate => ({ unit: "m3/min", ratePerMinute, quality });
const cap = (destination: string, rates: CapRate[] = [items(60)], count = 1, extra: Partial<DestinationCap> = {}): DestinationCap => ({ destination, count, rates, ...extra });

describe("capSlots", () => {
  it("shows every kind up to CAPS_MAX, then the first CAPS_MAX - 1 and one '+k' for the rest", () => {
    const kinds = ["storage", "depot", "sink", "power", "export", "unknown"].map((d) => cap(d));
    expect(capSlots(kinds.slice(0, CAPS_MAX)).map((s) => s.kind)).toEqual(["cap", "cap", "cap", "cap"]);
    const five = capSlots(kinds.slice(0, 5));
    expect(five.map((s) => (s.kind === "cap" ? s.cap.destination : `+${s.more.length}`))).toEqual(["storage", "depot", "sink", "+2"]);
    const six = capSlots(kinds);
    expect(six).toHaveLength(CAPS_MAX);
    expect(six[3]).toEqual({ kind: "more", more: kinds.slice(3) });
    expect(capSlots([])).toEqual([]);
  });
});

describe("capStep and capQuality: the speed by rate and quality", () => {
  it("steps a measured or estimated rate exactly as a line of the same rate", () => {
    for (const rate of [1, ITEMS_MID_FROM - 1, ITEMS_MID_FROM, ITEMS_FAST_FROM - 1, ITEMS_FAST_FROM, 5000]) {
      expect(capStep(cap("storage", [items(rate)]))).toBe(rateStep(rate, "items/min"));
      expect(capStep(cap("storage", [items(rate, "estimated")]))).toBe(rateStep(rate, "items/min"));
    }
    expect(capStep(cap("storage", [fluid(FLUID_MID_FROM)]))).toBe("mid");
    expect(capQuality(cap("storage", [items(10)]))).toBe("measured");
    expect(capQuality(cap("storage", [items(10, "estimated")]))).toBe("estimated");
    // An "at least" sum is estimated, and moves at its step.
    expect(capQuality(cap("storage", [items(200, "atLeast")]))).toBe("estimated");
    expect(capStep(cap("storage", [items(200, "atLeast")]))).toBe("mid");
  });

  it("keeps an unknown, a zero and a missing rate still, and calls only a cap with no number unknown", () => {
    expect(capQuality(cap("storage", [items(null, "unknown")]))).toBe("unknown");
    expect(capStep(cap("storage", [items(null, "unknown")]))).toBeNull();
    expect(capQuality(cap("storage", []))).toBe("unknown");
    expect(capStep(cap("storage", []))).toBeNull();
    expect(capStep(cap("storage", [items(0)]))).toBeNull();
    expect(capQuality(cap("storage", [items(0)]))).toBe("measured");
    expect(capStep(cap("storage", [items(Number.NaN)]))).toBeNull();
    expect(capQuality(cap("storage", [items(Number.POSITIVE_INFINITY)]))).toBe("unknown");
  });

  it("keeps a stalled cap still whatever its rate", () => {
    expect(capStep(cap("storage", [items(600)], 1, { stalled: "backedUp" }))).toBeNull();
    expect(capStep(cap("storage", [items(600)]))).toBe("fast");
  });

  it("moves a cap of items and fluid at the faster of each unit's own step, never comparing the numbers", () => {
    // 400 items/min is mid; 700 m³/min is fast for a pipe.
    expect(capStep(cap("storage", [items(400), fluid(700)]))).toBe("fast");
    // 500 items/min is fast; 100 m³/min is slow.
    expect(capStep(cap("storage", [items(500), fluid(100)]))).toBe("fast");
    expect(capStep(cap("storage", [items(100), fluid(100)]))).toBe("slow");
    // A unit with no number makes the cap estimated, not measured.
    expect(capQuality(cap("storage", [items(100), fluid(null, "unknown")]))).toBe("estimated");
  });

  it("tells a fluid-only cap (the pipe colour) and a moving one", () => {
    expect(capFluid(cap("storage", [fluid(100)]))).toBe(true);
    expect(capFluid(cap("storage", [items(100), fluid(100)]))).toBe(false);
    expect(capFluid(cap("storage", []))).toBe(false);
    expect(capMoving(cap("storage", [items(10)]))).toBe(true);
    expect(capMoving(cap("storage", [items(0)]))).toBe(false);
    expect(capMoving(cap("storage", [items(10, "estimated")]))).toBe(false);
  });
});

describe("sumCapRates and withCapStalled", () => {
  it("sums each unit by ADR-0053 Decision 3's rule, items first", () => {
    const part = (ratePerMinute: number | null, rate: "measured" | "estimated" | "unknown", unit: "items/min" | "m3/min" = "items/min") => ({ ratePerMinute, rate, unit });
    expect(sumCapRates([part(30, "measured"), part(20, "measured")])).toEqual([items(50)]);
    expect(sumCapRates([part(30, "measured"), part(20, "estimated")])).toEqual([items(50, "estimated")]);
    expect(sumCapRates([part(30, "measured"), part(null, "unknown")])).toEqual([items(30, "atLeast")]);
    // A number the backend called unknown does not count.
    expect(sumCapRates([part(30, "unknown")])).toEqual([items(null, "unknown")]);
    expect(sumCapRates([part(300, "measured", "m3/min"), part(5, "estimated")])).toEqual([items(5, "estimated"), fluid(300)]);
    expect(sumCapRates([])).toEqual([]);
  });

  it("stalls a stalled card's caps unless the game measured them moving", () => {
    const moving = cap("storage", [items(10)]);
    const estimated = cap("sink", [items(10, "estimated")]);
    const zero = cap("depot", [items(0)]);
    expect(withCapStalled([moving, estimated, zero], "backedUp").map((c) => c.stalled)).toEqual([undefined, "backedUp", "backedUp"]);
    expect(withCapStalled([moving], undefined)).toEqual([moving]);
  });
});

describe("capText: the rate and its quality in words (the cap's <title> and button)", () => {
  it("says the rate, its quality and the destination, and the count past one", () => {
    expect(capText(cap("storage", [items(120, "estimated")], 3))).toBe("about 120 items/min to storage, 3 flows");
    expect(capText(cap("sink", [items(48)]))).toBe("48 items/min to the Sink");
    expect(capText(cap("depot", [items(48, "atLeast")], 2))).toBe("at least 48 items/min to the Depot, 2 flows");
    expect(capText(cap("export", [items(10)]))).toBe("10 items/min leaving by station");
  });

  it("says when the rate is unknown, and makes the known units 'at least' when another has no number", () => {
    expect(capText(cap("power", [items(null, "unknown")], 2))).toBe("2 flows to power, rate unknown");
    expect(capText(cap("power", []))).toBe("1 flow to power, rate unknown");
    expect(capText(cap("storage", [items(100), fluid(null, "unknown")], 2))).toBe("at least 100 items/min to storage, 2 flows");
    expect(capText(cap("storage", [items(100), fluid(300, "estimated")], 2))).toBe("100 items/min and about 300 m³/min to storage, 2 flows");
  });

  it("says a stalled cap's state, and a destination this build does not know as the backend's word", () => {
    expect(capText(cap("storage", [items(0)], 1, { stalled: "backedUp" }))).toBe("0 items/min to storage, not moving: backed up");
    expect(capText(cap("teleporter", [items(5)]))).toBe("5 items/min to teleporter");
    // Keys that are not own properties of the words table are plain strings.
    expect(capText(cap("__proto__", [items(5)]))).toBe("5 items/min to __proto__");
    expect(capText(cap("toString", [], 2))).toBe("2 flows to toString, rate unknown");
  });

  it("words a '+k' cap with every kind it stands for", () => {
    expect(moreCapsText([cap("power", [], 2), cap("export", [], 1)])).toBe("2 more destinations (2 flows to power, 1 flow leaving by station), 3 flows");
  });
});
