import { describe, it, expect } from "vitest";
import { createMetricsAggregator } from "./aggregator.js";
import { UnknownMetricError, InvalidLabelError } from "./registry.js";
import { emptyBucketCounts } from "./histogramBuckets.js";

const HOUR = new Date("2026-09-27T10:00:00Z").getTime();

describe("createMetricsAggregator", () => {
  it("accumulates count, sum and the right bucket for a histogram", () => {
    const aggregator = createMetricsAggregator(() => HOUR);
    aggregator.recordHistogram("http.server.request.duration", { route: "/x", status_class: "2xx" }, 3);
    aggregator.recordHistogram("http.server.request.duration", { route: "/x", status_class: "2xx" }, 3);
    aggregator.recordHistogram("http.server.request.duration", { route: "/x", status_class: "2xx" }, 5_000);
    const [delta] = aggregator.drain();
    expect(delta.count).toBe(3);
    expect(delta.sum).toBe(3 + 3 + 5_000);
    const expected = emptyBucketCounts();
    expected[2] = 2; // 3ms falls in the "<=5" bucket, index 2
    expected[11] = 1; // 5000ms falls in the "<=5000" bucket, index 11
    expect(delta.bucketCounts).toEqual(expected);
  });

  it("keeps different label sets as separate deltas, regardless of key order", () => {
    const aggregator = createMetricsAggregator(() => HOUR);
    aggregator.recordHistogram("http.server.request.duration", { route: "/a", status_class: "2xx" }, 1);
    aggregator.recordHistogram("http.server.request.duration", { status_class: "2xx", route: "/a" }, 1); // same labels, different key order
    aggregator.recordHistogram("http.server.request.duration", { route: "/b", status_class: "2xx" }, 1);
    const deltas = aggregator.drain();
    expect(deltas).toHaveLength(2);
    expect(deltas.find((d) => d.labels.route === "/a")?.count).toBe(2);
    expect(deltas.find((d) => d.labels.route === "/b")?.count).toBe(1);
  });

  it("counters accumulate count and sum, with no bucket counts", () => {
    const aggregator = createMetricsAggregator(() => HOUR);
    aggregator.recordCounter("satis.history.rows_written", { table: "power_samples" }, 5);
    aggregator.recordCounter("satis.history.rows_written", { table: "power_samples" }, 7);
    const [delta] = aggregator.drain();
    expect(delta.count).toBe(2); // two recordings...
    expect(delta.sum).toBe(12); // ...totalling 12 rows
    expect(delta.bucketCounts).toBeUndefined();
  });

  it("refuses an unknown metric or an out-of-set label, and records nothing for it", () => {
    const aggregator = createMetricsAggregator(() => HOUR);
    expect(() => aggregator.recordHistogram("not.a.metric", {}, 1)).toThrow(UnknownMetricError);
    expect(() => aggregator.recordHistogram("http.server.request.duration", { route: "/x", status_class: "nope" }, 1)).toThrow(InvalidLabelError);
    expect(aggregator.drain()).toEqual([]);
  });

  describe("drain (what makes a flush idempotent)", () => {
    it("clears the aggregator, so draining twice in a row with nothing recorded in between returns nothing the second time", () => {
      const aggregator = createMetricsAggregator(() => HOUR);
      aggregator.recordHistogram("http.server.request.duration", { route: "/x", status_class: "2xx" }, 1);
      expect(aggregator.drain()).toHaveLength(1);
      expect(aggregator.drain()).toEqual([]); // nothing new since the last drain
    });

    it("a recording made after a drain starts a fresh delta, not added onto the drained one", () => {
      const aggregator = createMetricsAggregator(() => HOUR);
      aggregator.recordHistogram("http.server.request.duration", { route: "/x", status_class: "2xx" }, 1);
      aggregator.drain();
      aggregator.recordHistogram("http.server.request.duration", { route: "/x", status_class: "2xx" }, 1);
      const [delta] = aggregator.drain();
      expect(delta.count).toBe(1);
    });
  });

  it("buckets a sample into the hour it happened in, from the injected clock", () => {
    const aggregator = createMetricsAggregator(() => HOUR + 1_234);
    aggregator.recordHistogram("http.server.request.duration", { route: "/x", status_class: "2xx" }, 1);
    expect(aggregator.drain()[0].hourStartMs).toBe(HOUR);
  });
});
