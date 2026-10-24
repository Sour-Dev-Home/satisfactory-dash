import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { tickTone } from "./tick";
import { GAUGE_MAX, SLOW_BELOW, TickGauge } from "./TickGauge";

// Pure geometry: no query, no fixture. Renders the gauge at the scale's boundaries and at
// values a validated status response should never send, so a future loosening of the
// contract (packages/shared/src/status.ts's z.number().min(0)) fails here first, not as a
// blank or NaN-filled dial in the browser.

function svgOf(rate: number) {
  const { container } = render(<TickGauge rate={rate} />);
  return container.querySelector("svg")!;
}

describe("TickGauge", () => {
  it.each([0, SLOW_BELOW, GAUGE_MAX])("clamps to itself at the boundary value %d", (rate) => {
    expect(svgOf(rate)).toHaveAttribute("data-gauge", String(rate));
  });

  it("clamps a negative rate to 0", () => {
    expect(svgOf(-5)).toHaveAttribute("data-gauge", "0");
  });

  it("clamps a rate far above the scale to the max", () => {
    expect(svgOf(1000)).toHaveAttribute("data-gauge", String(GAUGE_MAX));
  });

  it.each([0, SLOW_BELOW, GAUGE_MAX, -5, 1000])("draws a bar with a finite width at rate %d", (rate) => {
    const fill = svgOf(rate).querySelector('[data-zone="value"]');
    // Nothing to fill at zero or below.
    expect(Number.isFinite(Number(fill?.getAttribute("width") ?? 0))).toBe(true);
    expect(fill === null).toBe(rate <= 0);
  });

  it("fills in proportion to the 0-30 scale", () => {
    expect(svgOf(15).querySelector('[data-zone="value"]')).toHaveAttribute("width", "60");
  });

  it("draws nothing red while the tick is healthy, at any rate", () => {
    for (const rate of [0, 5, SLOW_BELOW, 29.6, GAUGE_MAX]) {
      const svg = svgOf(rate);
      expect(svg.querySelector(".text-bad")).toBeNull();
      svg.parentElement!.remove();
    }
  });

  it.each([
    [29.6, "healthy", "ok"],
    [4, "healthy", "ok"],
    [12, "slow", "warn"],
    [SLOW_BELOW, "slow", "warn"],
    [8.2, "slow", "bad"],
  ] as const)("colours its fill at %d ticks/s (%s) as %s, by the same verdict as its word", (rate, health, tone) => {
    const { container } = render(<TickGauge rate={rate} health={health} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("data-tone", tone);
    expect(svg.querySelector('[data-zone="value"]')).toHaveClass(`text-${tone}`);
    expect(tickTone({ rate, health })).toBe(tone);
  });

  it("draws no fill and marks itself NaN for a non-finite rate (data validation's job, not this component's)", () => {
    const svg = svgOf(NaN);
    expect(svg).toHaveAttribute("data-gauge", "NaN");
    expect(svg.querySelector('[data-zone="value"]')).toBeNull();
  });
});
