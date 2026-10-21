import type { Logger } from "pino";
import type { Queryable } from "../db/schemaVersion.js";
import { SeriesFlushWorker } from "./seriesFlushWorker.js";
import type { MetricsAggregator } from "./aggregator.js";
import { backgroundAggregator } from "./backgroundMetrics.js";

export { createMetricsAggregator } from "./aggregator.js";
export type { MetricsAggregator } from "./aggregator.js";
export { requestMetrics } from "./requestMetrics.js";
export { AGENT_REFUSED_STATUSES, METRIC_REGISTRY, UnknownMetricError, InvalidLabelError } from "./registry.js";
export { createBackgroundRecorder } from "./backgroundMetrics.js";
export type { MetricsRecorder, MetricsSink } from "./backgroundMetrics.js";

/** ADR-0037 §2, started with the other database workers (server.ts): flushes the aggregator into
 *  `metrics.series_hourly` every 60 s and purges rows past 90 days about once an hour. Build step 3:
 *  each flush also drains `backgroundAggregator`, where the background sources record. */
export function createSeriesFlushWorker(db: Queryable, aggregator: MetricsAggregator, logger: Logger): SeriesFlushWorker {
  const both: MetricsAggregator =
    aggregator === backgroundAggregator
      ? aggregator
      : {
          recordHistogram: (metric, labels, valueMs) => aggregator.recordHistogram(metric, labels, valueMs),
          recordCounter: (metric, labels, amount) => aggregator.recordCounter(metric, labels, amount),
          drain: () => [...aggregator.drain(), ...backgroundAggregator.drain()],
        };
  return new SeriesFlushWorker(db, both, { logger });
}
