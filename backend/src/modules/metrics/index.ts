/**
 * The metrics module's public API (ADR-0056): the operator-only metrics page's backend. It reads `metrics.series_hourly`
 * (ADR-0037) and, through the alerts module's index, the alert log's quality summary (PR 4); the delivery snapshot
 * (PR 6) fills the last section.
 */
export { createMetricsRouter } from "./metricsRouter.js";
export type { MetricsRouterOptions } from "./metricsRouter.js";
export { createMetricsService } from "./metricsService.js";
export type { MetricsService, MetricsServiceOptions } from "./metricsService.js";
