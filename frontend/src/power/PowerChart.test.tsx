import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import uPlot from "uplot";
import { PowerChart } from "./PowerChart";

// Fresh-eyes pass (PR #215): the redraw() identity-check effect added for trippedRanges.
describe("PowerChart, redraw on prop identity", () => {
  it("does not redraw on mount, or on a rerender with the same range identities", () => {
    const redraw = vi.spyOn(uPlot.prototype as unknown as { redraw: () => void }, "redraw");
    const data: uPlot.AlignedData = [[0, 1], [1, 2]];
    const paused = [] as const;
    const { rerender } = render(<PowerChart data={data} pausedRanges={paused} />);
    expect(redraw).not.toHaveBeenCalled();

    // Same identities (trippedRanges defaults to the same module-level empty array both times).
    rerender(<PowerChart data={data} pausedRanges={paused} />);
    expect(redraw).not.toHaveBeenCalled();
    redraw.mockRestore();
  });

  it("redraws when only trippedRanges changes identity, leaving pausedRanges alone", () => {
    const redraw = vi.spyOn(uPlot.prototype as unknown as { redraw: () => void }, "redraw");
    const data: uPlot.AlignedData = [[0, 1], [1, 2]];
    const paused = [] as const;
    const { rerender } = render(<PowerChart data={data} pausedRanges={paused} />);

    const tripped = [{ fromT: 0, toT: 1000 }];
    rerender(<PowerChart data={data} pausedRanges={paused} trippedRanges={tripped} />);
    expect(redraw).toHaveBeenCalledTimes(1);

    // A further rerender with the same tripped array reference: no more redraws.
    rerender(<PowerChart data={data} pausedRanges={paused} trippedRanges={tripped} />);
    expect(redraw).toHaveBeenCalledTimes(1);
    redraw.mockRestore();
  });
});
