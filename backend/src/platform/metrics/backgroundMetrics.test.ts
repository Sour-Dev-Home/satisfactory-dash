import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { createMetricsAggregator } from "./aggregator.js";
import { createBackgroundRecorder, type MetricsSink } from "./backgroundMetrics.js";

function fakeLogger() {
  const warn = vi.fn();
  return { warn, logger: { warn } as unknown as Logger };
}

describe("createBackgroundRecorder (ADR-0037 build step 3: recording never throws into its source)", () => {
  it("records histograms and counters into the sink it wraps", () => {
    const aggregator = createMetricsAggregator(() => 0);
    const recorder = createBackgroundRecorder(fakeLogger().logger, aggregator);
    recorder.histogram("satis.alerts.evaluation.duration", {}, 12);
    recorder.counter("satis.history.rows_written", { table: "power_samples" }, 3);
    const deltas = aggregator.drain();
    expect(deltas.find((d) => d.metric === "satis.alerts.evaluation.duration")).toMatchObject({ count: 1, sum: 12 });
    expect(deltas.find((d) => d.metric === "satis.history.rows_written")).toMatchObject({ labels: { table: "power_samples" }, count: 1, sum: 3 });
  });

  it("drops a refused recording (an out-of-set label) without throwing, and logs it once per metric", () => {
    const { warn, logger } = fakeLogger();
    const aggregator = createMetricsAggregator(() => 0);
    const recorder = createBackgroundRecorder(logger, aggregator);
    expect(() => recorder.histogram("satis.poller.lag", { server: "abc", group: "nope" }, 1)).not.toThrow();
    expect(() => recorder.histogram("satis.poller.lag", { server: "abc", group: "nope" }, 1)).not.toThrow();
    expect(() => recorder.counter("satis.history.rows_written", { table: "nope" })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2); // once for each failing metric, not once per recording
    expect(aggregator.drain()).toEqual([]);
  });

  it("swallows a sink that throws anything (not only a registry error)", () => {
    const { warn, logger } = fakeLogger();
    const sink: MetricsSink = {
      recordHistogram() {
        throw new Error("boom");
      },
      recordCounter() {
        throw "not even an Error";
      },
    };
    const recorder = createBackgroundRecorder(logger, sink);
    expect(() => recorder.histogram("satis.alerts.evaluation.duration", {}, 1)).not.toThrow();
    expect(() => recorder.counter("satis.history.rows_written", { table: "item_samples" })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("drops a value that is not a finite number instead of recording it", () => {
    const { warn, logger } = fakeLogger();
    const aggregator = createMetricsAggregator(() => 0);
    const recorder = createBackgroundRecorder(logger, aggregator);
    recorder.histogram("satis.alerts.evaluation.duration", {}, Number.NaN);
    recorder.histogram("satis.alerts.evaluation.duration", {}, Number.POSITIVE_INFINITY);
    expect(aggregator.drain()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("survives a logger that throws too", () => {
    const logger = {
      warn() {
        throw new Error("log sink down");
      },
    } as unknown as Logger;
    const recorder = createBackgroundRecorder(logger, createMetricsAggregator(() => 0));
    expect(() => recorder.histogram("satis.poller.lag", { server: "abc", group: "nope" }, 1)).not.toThrow();
  });
});
