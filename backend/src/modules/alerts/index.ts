/**
 * The alerts module's public API (ADR-0014, ADR-0027 PR 5 and 6): the alert engine and its delivery. It reads the
 * telemetry module's pollers' last readings through its index, and the server list through the servers module's index;
 * it owns the `alerts` schema. The engine records every transition in the alert log; delivery (the transactional outbox
 * and the Discord sender) runs only when ALERT_DELIVERY is on (default off). The rules API is PR 7b (routes/, and
 * services/alertsService.ts behind an interface).
 */
import type { Router } from "express";
import type { Logger } from "pino";
import type { ServerDirectory } from "../servers/index.js";
import type { BackgroundWorker, TelemetryScope } from "../telemetry/index.js";
import type { SecretsKeyring } from "../../platform/secrets/secrets.js";
import { AlertDeliveryWorker, type DeliveryDb } from "./services/alertDeliveryWorker.js";
import { AlertEvaluatorWorker, type AlertsDb } from "./services/alertEvaluatorWorker.js";
import { createAlertsRouter } from "./routes/alerts.js";
import { createPushRouter } from "./routes/push.js";
import type { AlertsService } from "./services/alertsService.js";
import type { PushService } from "./services/pushService.js";
import type { AlertDeliveryMode } from "./config.js";
import type { PushConfig } from "./pushConfig.js";

export { createAlertsService, MAX_RULES_PER_SERVER } from "./services/alertsService.js";
export type { AlertsService, AlertsServiceDeps } from "./services/alertsService.js";

/** The alerts API (ADR-0027 PR 7b): rules, the Discord destination, the alert log, status and mute, under
 *  /api/servers/:serverId/alerts. Mount it AFTER the servers router, whose membership check covers these paths. */
export function createAlertsRouters(service: AlertsService): Router[] {
  return [createAlertsRouter(service)];
}

/** The web push API (ADR-0044, task 348-1): config, the caller's subscriptions and the per-server opt-in. Mount it behind
 *  the session guard AFTER the servers router, and only with a database. */
export function createPushRouters(service: PushService): Router[] {
  return [createPushRouter(service)];
}
export { createPushService } from "./services/pushService.js";
export type { PushService, PushServiceDeps } from "./services/pushService.js";
export { loadPushConfig, type PushConfig } from "./pushConfig.js";

export type { AlertsDb } from "./services/alertEvaluatorWorker.js";
export type { DeliveryDb } from "./services/alertDeliveryWorker.js";
export { loadAlertDeliveryMode, type AlertDeliveryMode } from "./config.js";
export { saveDiscordDestination, getDestinationSummary } from "./repositories/deliveryRepository.js";
export { sendAlertTest, type SendTestCode } from "./services/sendTest.js";

/** The process-wide evaluator: start it once the database is up, stop it on shutdown. With `deliver` (ALERT_DELIVERY on)
 *  every new event is also queued for the server's enabled destinations, in the same transaction. */
export function createAlertEvaluator(
  db: AlertsDb,
  directory: ServerDirectory<TelemetryScope>,
  logger: Logger,
  options: { deliver?: boolean; deliverPush?: boolean } = {},
): BackgroundWorker {
  return new AlertEvaluatorWorker(db, directory, { logger, deliver: options.deliver, deliverPush: options.deliverPush });
}

/** Whether web push is enabled (ADR-0044 decision 4): ALERT_DELIVERY on, VAPID configured and a secrets keyring. The
 *  same rule as `GET /api/push/config`; the evaluator queues push rows only then. */
export function pushEnabled(mode: AlertDeliveryMode, config: PushConfig, ring: SecretsKeyring | null): boolean {
  return mode === "on" && config.vapid !== null && ring !== null;
}

/** The outbox sender (Discord and, with `push`, web push). Create it only when ALERT_DELIVERY is on. */
export function createAlertDelivery(db: DeliveryDb, ring: SecretsKeyring, logger: Logger, options: { push?: PushConfig } = {}): BackgroundWorker {
  const vapid = options.push?.vapid ?? null;
  return new AlertDeliveryWorker(db, ring, {
    logger,
    ...(vapid !== null && options.push !== undefined ? { push: { vapid, allowedHosts: options.push.allowedHosts } } : {}),
  });
}
