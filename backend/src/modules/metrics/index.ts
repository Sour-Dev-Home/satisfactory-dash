/**
 * The metrics module's public API (ADR-0056): the operator-only metrics page's backend. It reads `metrics.series_hourly`
 * (ADR-0037) and nothing else yet; alert quality (PR 4) and the delivery snapshot (PR 6) fill the other two sections.
 */
export { createMetricsRouter } from "./metricsRouter.js";
export type { MetricsRouterOptions } from "./metricsRouter.js";
export { createMetricsService } from "./metricsService.js";
export type { MetricsService, MetricsServiceOptions } from "./metricsService.js";
