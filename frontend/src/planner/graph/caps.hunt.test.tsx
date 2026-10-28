import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { capText, moreCapsText } from "../plannerText";
import { CapRow } from "./DestinationCaps";
import { capSlots, capStep, sumCapRates, withCapStalled, type DestinationCap } from "./capModel";
import { capStops } from "./capLayout";
import { nextStop } from "./rovingStop";
import type { Card } from "./canvasScene";

const cap = (over: Partial<DestinationCap> = {}): DestinationCap => ({
  destination: "storage",
  count: 1,
  rates: [{ unit: "items/min", ratePerMinute: 60, quality: "measured" }],
  ...over,
});

describe("destination caps, hunt", () => {
  it("treats a server-sent '__proto__' / 'constructor' destination as plain words and a glyph, never a lookup hit", () => {
    for (const destination of ["__proto__", "constructor", "toString"]) {
      expect(capText(cap({ destination }))).toContain(`to ${destination}`);
      const card = { caps: [cap({ destination })], label: "F", machines: undefined } as unknown as Card;
      const { container } = render(
        <svg>
          <CapRow card={card} lines={2} marks marching={undefined} ringed={null} onCap={() => {}} />
        </svg>,
      );
      expect(container.querySelector(`[data-cap="${destination}"] [data-cap-art="glyph"]`)).not.toBeNull();
    }
  });

  it("keeps non-finite rates out of the sum and still", () => {
    const rates = sumCapRates([
      { ratePerMinute: Number.NaN, rate: "measured", unit: "items/min" },
      { ratePerMinute: Number.POSITIVE_INFINITY, rate: "estimated", unit: "items/min" },
    ]);
    expect(rates).toEqual([{ unit: "items/min", ratePerMinute: null, quality: "unknown" }]);
    expect(capStep({ rates, stalled: undefined })).toBeNull();
  });

  it("badges 100+ flows as 99+ and none for one flow", () => {
    const card = { caps: [cap({ count: 250 }), cap({ destination: "sink", count: 1 })], label: "F" } as unknown as Card;
    const { container } = render(
      <svg>
        <CapRow card={card} lines={1} marks={false} marching={undefined} ringed={null} onCap={() => {}} />
      </svg>,
    );
    expect(container.querySelectorAll("[data-cap-badge]")).toHaveLength(1);
    expect(container.querySelector("[data-cap-badge]")?.getAttribute("data-cap-badge")).toBe("99+");
  });

  it("draws nothing for an empty caps array and no stops for it", () => {
    const card = { caps: [], label: "F" } as unknown as Card;
    const { container } = render(
      <svg>
        <CapRow card={card} lines={1} marks marching={undefined} ringed={null} onCap={() => {}} />
      </svg>,
    );
    expect(container.querySelector("[data-cap-row]")).toBeNull();
    expect(capStops([{ key: "a", card }])).toEqual([]);
    expect(capSlots([])).toEqual([]);
  });

  it("does not stall a card with an empty list, and leaves a measured moving cap alone", () => {
    expect(withCapStalled([], "stalled" as never)).toEqual([]);
  });

  it("words the '+k' cap with singular and plural totals", () => {
    expect(moreCapsText([{ destination: "sink", count: 1 }])).toContain("1 flow");
    expect(moreCapsText([{ destination: "sink", count: 1 }])).not.toContain("1 flows");
  });

  it("roving stop: a single stop stays put, an unknown key is left alone", () => {
    expect(nextStop("ArrowRight", 0, 1)).toBe(0);
    expect(nextStop("ArrowLeft", 0, 1)).toBe(0);
    expect(nextStop("End", 0, 3)).toBe(2);
    expect(nextStop("Home", 2, 3)).toBe(0);
    expect(nextStop("a", 0, 3)).toBeNull();
  });
});
