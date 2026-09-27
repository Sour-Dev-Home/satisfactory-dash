import type { Logger } from "pino";
import type { Queryable } from "../db/schemaVersion.js";
import { SeriesFlushWorker } from "./seriesFlushWorker.js";
import type { MetricsAggregator } from "./aggregator.js";

export { createMetricsAggregator } from "./aggregator.js";
export type { MetricsAggregator } from "./aggregator.js";
export { requestMetrics } from "./requestMetrics.js";
export { METRIC_REGISTRY, UnknownMetricError, InvalidLabelError } from "./registry.js";

/** ADR-0037 §2, started with the other database workers (server.ts): flushes the aggregator into
 *  `metrics.series_hourly` every 60 s and purges rows past 90 days about once an hour. */
export function createSeriesFlushWorker(db: Queryable, aggregator: MetricsAggregator, logger: Logger): SeriesFlushWorker {
  return new SeriesFlushWorker(db, aggregator, { logger });
}
