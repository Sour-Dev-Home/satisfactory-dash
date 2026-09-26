/**
 * The alerts module's public API (ADR-0014, ADR-0027 PR 5 and 6): the alert engine and its delivery. It reads the
 * telemetry module's pollers' last readings through its index, and the server list through the servers module's index;
 * it owns the `alerts` schema. The engine records every transition in the alert log; delivery (the transactional outbox
 * and the Discord sender) runs only when ALERT_DELIVERY is on (default off). The rules API is PR 7.
 */
import type { Logger } from "pino";
import type { ServerDirectory } from "../servers/index.js";
import type { BackgroundWorker, TelemetryScope } from "../telemetry/index.js";
import type { SecretsKeyring } from "../../platform/secrets/secrets.js";
import { AlertDeliveryWorker, type DeliveryDb } from "./services/alertDeliveryWorker.js";
import { AlertEvaluatorWorker, type AlertsDb } from "./services/alertEvaluatorWorker.js";

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
  options: { deliver?: boolean } = {},
): BackgroundWorker {
  return new AlertEvaluatorWorker(db, directory, { logger, deliver: options.deliver });
}

/** The outbox sender. Create it only when ALERT_DELIVERY is on. */
export function createAlertDelivery(db: DeliveryDb, ring: SecretsKeyring, logger: Logger): BackgroundWorker {
  return new AlertDeliveryWorker(db, ring, { logger });
}
