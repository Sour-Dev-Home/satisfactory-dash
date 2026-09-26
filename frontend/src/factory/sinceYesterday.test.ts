import type { HistoryItems, HistoryItemSeriesSchema } from "@satisfactory-dash/shared";
import { historyItems7d, historyTransitions24h } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { latestCompleteHour, NOTABLE_CHANGE, sinceYesterday, transitionCount } from "./sinceYesterday";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const H0 = 1_790_337_600_000; // an hour boundary
const to = H0 + 14 * 60_000; // 14 minutes into an open hour: H0 is not complete yet

type Series = z.infer<typeof HistoryItemSeriesSchema>;
const point = (t: number, avg: number) => ({ t, samples: 120, currentPerMinute: { min: avg, avg, max: avg }, maxPerMinute: 100 });
/** An item with `before` in the compared hour yesterday and `after` in the latest complete hour. */
const item = (name: string, before: number | null, after: number | null, extra: Series["points"] = []): Series => ({
  item: name,
  points: [
    ...(before === null ? [] : [point(H0 - HOUR - DAY, before)]),
    ...extra,
    ...(after === null ? [] : [point(H0 - HOUR, after)]),
  ],
});
const history = (...series: Series[]): HistoryItems => ({ ...historyItems7d.data, to, series });

describe("latestCompleteHour", () => {
  it("never picks the hour that is still open", () => {
    expect(latestCompleteHour(H0 + 14 * 60_000)).toBe(H0 - HOUR);
  });

  it("waits for the last minute's rollup before calling an hour closed", () => {
    expect(latestCompleteHour(H0 + 60_000)).toBe(H0 - 2 * HOUR);
    expect(latestCompleteHour(H0 + 2 * 60_000)).toBe(H0 - HOUR);
  });
});

describe("sinceYesterday", () => {
  it("compares the latest complete hour with the same hour yesterday, drops and rises apart", () => {
    const result = sinceYesterday(history(item("Desc_Screw_C", 40, 12), item("Desc_Wire_C", 100, 130), item("Desc_IronPlate_C", 20, 20)));
    expect(result).toEqual({
      enough: true,
      hour: H0 - HOUR,
      down: [{ item: "Desc_Screw_C", before: 40, after: 12, delta: -28, ratio: -0.7 }],
      up: [{ item: "Desc_Wire_C", before: 100, after: 130, delta: 30, ratio: 0.3 }],
    });
  });

  it("ignores the open hour even when it has data", () => {
    const open = item("Desc_Screw_C", 40, 40, [point(H0, 0)]);
    expect(sinceYesterday(history(open))).toMatchObject({ enough: true, down: [], up: [] });
  });

  it("puts the biggest relative drop first, and keeps at most 3 per list", () => {
    const result = sinceYesterday(
      history(item("A", 100, 80), item("B", 10, 1), item("C", 50, 20), item("D", 1000, 850), item("E", 5, 0)),
    );
    if (!result.enough) throw new Error("expected a comparison");
    expect(result.down.map((c) => c.item)).toEqual(["E", "B", "C"]);
  });

  it(`needs ${NOTABLE_CHANGE.minRatio * 100}% and ${NOTABLE_CHANGE.minPerMinute} per min, both`, () => {
    const result = sinceYesterday(
      history(item("Small", 1000, 950), item("Trickle", 0.4, 0.1), item("Edge", 10, 9), item("New", 0, 5), item("Tiny new", 0, 0.5)),
    );
    if (!result.enough) throw new Error("expected a comparison");
    expect(result.down.map((c) => c.item)).toEqual(["Edge"]);
    expect(result.up).toEqual([{ item: "New", before: 0, after: 5, delta: 5, ratio: null }]);
  });

  it("leaves out an item with a gap in either hour, never interpolating", () => {
    const result = sinceYesterday(history(item("Gap today", 40, null), item("Gap yesterday", null, 5), item("Wire", 100, 50)));
    if (!result.enough) throw new Error("expected a comparison");
    expect(result.down.map((c) => c.item)).toEqual(["Wire"]);
    expect(result.up).toEqual([]);
  });

  it("says there isn't enough history when no item has both hours", () => {
    expect(sinceYesterday(history(item("A", null, 5)))).toEqual({ enough: false });
    expect(sinceYesterday(history())).toEqual({ enough: false });
    // The shared fixture holds only the last two hours, so nothing from yesterday.
    expect(sinceYesterday(historyItems7d.data)).toEqual({ enough: false });
  });

  it("refuses anything but hourly buckets (the 7d range)", () => {
    expect(sinceYesterday({ ...history(item("A", 10, 1)), resolutionSeconds: 300 })).toEqual({ enough: false });
  });
});

describe("transitionCount", () => {
  it("adds a + when the backend had more than it sent", () => {
    expect(transitionCount(historyTransitions24h.data)).toBe("2+");
    expect(transitionCount({ ...historyTransitions24h.data, truncated: false })).toBe("2");
    expect(transitionCount({ ...historyTransitions24h.data, truncated: false, transitions: [] })).toBe("0");
  });
});
