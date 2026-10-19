import type { Logger } from "pino";
import { formatErrorDetail } from "../formatErrorDetail.js";
import { createMetricsAggregator, type MetricsAggregator } from "./aggregator.js";

/** What a source records into: an aggregator's recording half. */
export type MetricsSink = Pick<MetricsAggregator, "recordHistogram" | "recordCounter">;

/** The recording API a background source holds: never throws. */
export interface MetricsRecorder {
  histogram(metric: string, labels: Readonly<Record<string, string>>, valueMs: number): void;
  counter(metric: string, labels: Readonly<Record<string, string>>, amount?: number): void;
}

/**
 * ADR-0037 build step 3: the process-wide aggregator the background sources (the pollers, the agent
 * ingest route, the history writer, the alert engine) record into. They are built in many places, far
 * from the composition root's request aggregator, so they share this one instead, and
 * `createSeriesFlushWorker` (index.ts) drains it along with the request aggregator. Without a database
 * there is no flush worker and nothing reads it, exactly like the request aggregator.
 */
export const backgroundAggregator: MetricsAggregator = createMetricsAggregator();

/**
 * Wraps a sink so recording can never throw into the component it measures: a refused recording (an
 * unregistered metric, an out-of-set label), a non-finite value, or a sink that throws anything is
 * dropped, and logged once per metric name for the life of this recorder, so a bug that fails every
 * poll doesn't write a line every poll. Even the log call is guarded.
 */
export function createBackgroundRecorder(logger: Logger, sink: MetricsSink = backgroundAggregator): MetricsRecorder {
  const reported = new Set<string>();
  const dropped = (metric: string, err: unknown): void => {
    if (reported.has(metric)) return;
    reported.add(metric);
    try {
      logger.warn({ metric, err: formatErrorDetail(err) }, "failed to record a metric; dropping it");
    } catch {
      // A failing logger must not reach the source either.
    }
  };
  return {
    histogram(metric, labels, valueMs) {
      try {
        if (!Number.isFinite(valueMs)) throw new Error("the value is not a finite number");
        sink.recordHistogram(metric, labels, valueMs);
      } catch (err) {
        dropped(metric, err);
      }
    },
    counter(metric, labels, amount) {
      try {
        sink.recordCounter(metric, labels, amount);
      } catch (err) {
        dropped(metric, err);
      }
    },
  };
}
