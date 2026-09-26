/**
 * The alerts module's public API (ADR-0014, ADR-0027 PR 5): the alert engine. It reads the telemetry module's
 * pollers' last readings through its index, and the server list through the servers module's index; it owns the
 * `alerts` schema. PR 5 only RECORDS alert events in the alert log; delivery (the outbox and Discord, behind
 * ALERT_DELIVERY) is PR 6 and the rules API is PR 7.
 */
import type { Logger } from "pino";
import type { ServerDirectory } from "../servers/index.js";
import type { BackgroundWorker, TelemetryScope } from "../telemetry/index.js";
import { AlertEvaluatorWorker, type AlertsDb } from "./services/alertEvaluatorWorker.js";

export type { AlertsDb } from "./services/alertEvaluatorWorker.js";

/** The process-wide evaluator: start it once the database is up, stop it on shutdown. */
export function createAlertEvaluator(db: AlertsDb, directory: ServerDirectory<TelemetryScope>, logger: Logger): BackgroundWorker {
  return new AlertEvaluatorWorker(db, directory, { logger });
}
