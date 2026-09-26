import { ConfigError } from "../../platform/errors.js";

/**
 * ADR-0027 decision 5, the kill switch: `ALERT_DELIVERY=on|off`, default OFF. While it is off the alert engine still
 * records every transition in the alert log but writes NO outbox rows, and nothing is ever sent (a send-test answers
 * `delivery_off`). Switching it on sends only transitions that happen AFTER that, because nothing was queued before.
 * Anything other than on/off (a typo, "true", "1") stops the backend at startup, naming the variable: a misspelt
 * switch must never silently mean "off" or "on".
 */
export type AlertDeliveryMode = "on" | "off";

export function loadAlertDeliveryMode(env: NodeJS.ProcessEnv = process.env): AlertDeliveryMode {
  const raw = env.ALERT_DELIVERY;
  if (raw === undefined || raw.trim() === "") return "off";
  const value = raw.trim().toLowerCase();
  if (value === "on" || value === "off") return value;
  throw new ConfigError("ALERT_DELIVERY must be `on` or `off` (default off).");
}
