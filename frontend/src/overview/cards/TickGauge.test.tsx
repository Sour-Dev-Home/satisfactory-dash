import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

  it.each([0, SLOW_BELOW, GAUGE_MAX, -5, 1000])("draws a needle with finite coordinates at rate %d", (rate) => {
    const line = svgOf(rate).querySelector("line")!;
    expect(Number.isFinite(Number(line.getAttribute("x2")))).toBe(true);
    expect(Number.isFinite(Number(line.getAttribute("y2")))).toBe(true);
  });

  it("draws no needle and marks itself NaN for a non-finite rate (data validation's job, not this component's)", () => {
    const svg = svgOf(NaN);
    expect(svg).toHaveAttribute("data-gauge", "NaN");
    const line = svg.querySelector("line")!;
    expect(line.getAttribute("x2")).toBe("NaN");
  });
});
