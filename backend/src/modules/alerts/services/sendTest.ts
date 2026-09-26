import type { Queryable } from "../../../platform/db/schemaVersion.js";
import type { withTransaction } from "../../../platform/db/transaction.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";
import { disableDestination, getDestinationSummary, openServerWebhook } from "../repositories/deliveryRepository.js";
import type { AlertDeliveryMode } from "../config.js";
import { escapeDiscordText } from "./alertMessage.js";
import { sendDiscordMessage } from "./discordSender.js";

/**
 * ADR-0027 decision 5: the "Send test" for a server's Discord destination (the rules API in PR 7 calls this). It honours
 * the kill switch: with ALERT_DELIVERY off it sends NOTHING and answers `delivery_off`, a clear code. The answer is a
 * stable code and never carries the URL, a response body or an error message.
 */
export type SendTestCode =
  | "sent"
  | "delivery_off"
  | "no_destination"
  | "destination_disabled"
  | "secret_unreadable"
  | "webhook_gone"
  | "rate_limited"
  | "unavailable"
  | "rejected";

export async function sendAlertTest(input: {
  mode: AlertDeliveryMode;
  db: Queryable & Parameters<typeof withTransaction>[0];
  ring: SecretsKeyring;
  serverPublicId: string;
  serverName: string;
  fetch?: typeof fetch;
}): Promise<{ code: SendTestCode }> {
  if (input.mode !== "on") return { code: "delivery_off" };
  const summary = await getDestinationSummary(input.db, input.serverPublicId);
  if (summary === undefined) return { code: "no_destination" };
  if (!summary.enabled) return { code: "destination_disabled" };
  const opened = await openServerWebhook(input.db, input.ring, input.serverPublicId);
  if (opened === undefined) return { code: "secret_unreadable" };
  const outcome = await sendDiscordMessage(
    opened.url,
    {
      username: "Satisfactory Dash",
      embeds: [{ title: "Test message", description: `**${escapeDiscordText(input.serverName, 60) || "server"}**\nAlerts are set up for this server.`, color: 0x3498db }],
      allowed_mentions: { parse: [] },
    },
    { fetch: input.fetch },
  );
  switch (outcome.kind) {
    case "sent":
      return { code: "sent" };
    case "gone":
      await disableDestination(input.db, opened.destinationId, "webhook_gone");
      return { code: "webhook_gone" };
    case "retry":
      return { code: outcome.code === "rate_limited" ? "rate_limited" : "unavailable" };
    case "rejected":
      return { code: "rejected" };
  }
}
