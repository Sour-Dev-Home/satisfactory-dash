import type { Logger } from "pino";
import { recordAuditEvent } from "../../../platform/audit/auditRepository.js";
import type { MetricsRecorder, PUSH_DROP_REASONS } from "../../../platform/metrics/index.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";
import { markDeliveryDead, markDeliverySent, releaseDelivery, rescheduleDelivery, type DuePushDelivery } from "../repositories/deliveryRepository.js";
import { parsePushEndpoint } from "./pushEndpoint.js";
import { checkPushRecipient, deleteGoneSubscription, markSubscriptionSuccess } from "../repositories/pushRepository.js";
import { formatPushMessage, type MessageTransition } from "./alertMessage.js";
import { openPushSubscription, sendWebPush } from "./pushSender.js";
import { isDead, retryDelayMs } from "./retryPolicy.js";
import type { RuleKind, Severity } from "./rules.js";
import type { VapidKeys } from "./webPushCrypto.js";

/** What the sender needs to send a push: the VAPID keys and the endpoint allowlist (PushConfig with VAPID set). */
export interface PushSendConfig {
  vapid: VapidKeys;
  allowedHosts: readonly string[];
}

type PushDropReason = (typeof PUSH_DROP_REASONS)[number];

type PushDb =Queryable & Parameters<typeof withTransaction>[0];

/**
 * ADR-0044 (#348, task 348-2): one claimed push row, from the shared outbox (alertDeliveryWorker.ts claims it, with the
 * same per-server fairness and the same backoff as a Discord row).
 *
 * Just before sending: the recipient is checked again (still a member of the server, `identity.users.status = 'active'`,
 * still opted in: ADR-0044 decision 5 and #516's review), and the endpoint is checked against the allowlist again inside
 * `sendWebPush`. A row that fails either is dropped (`dead`, with the reason as its code) and counted in
 * `satis.alerts.push.dropped`. The response: 2xx sent; 404/410 deletes the subscription (and so its rows) with an audit
 * row; 429 and 5xx, a timeout or a network error retry with the existing backoff; anything else is dropped.
 *
 * Logs carry the server's public id, the alert kind, the transition, the attempt count and a stable code. Never the
 * endpoint, its host, a key, the payload or the user.
 */
export class PushDelivery {
  constructor(
    private readonly db: PushDb,
    private readonly ring: SecretsKeyring,
    private readonly options: { logger: Logger; push?: PushSendConfig; fetch?: typeof fetch; now: () => number; metrics: MetricsRecorder },
  ) {}

  /** `pausedHosts`: push hosts that rate limited, timed out or failed at the network earlier in this tick (filled here). */
  async deliver(delivery: DuePushDelivery, pausedHosts: Set<string> = new Set()): Promise<"done" | "paused"> {
    const now = this.options.now();
    const log = (code: string) =>
      this.options.logger.info(
        { serverId: delivery.serverPublicId, channel: "push", alert: delivery.event.kind, transition: delivery.event.transition, attempts: delivery.attempts, code },
        "alert delivery",
      );
    const drop = async (reason: PushDropReason, code: string = reason) => {
      await markDeliveryDead(this.db, delivery.outboxId, code);
      this.options.metrics.counter("satis.alerts.push.dropped", { server: delivery.serverPublicId, reason });
      log(code);
      return "done" as const;
    };

    if (isDead(delivery.createdAtMs, now)) return drop("expired");
    const push = this.options.push;
    if (push === undefined) return drop("push_disabled"); // VAPID was unset after the row was queued: nothing can sign it

    const verdict = await checkPushRecipient(this.db, delivery.serverId, delivery.userId);
    if (verdict !== "ok") return drop(verdict, `recipient_${verdict}`);

    const opened = openPushSubscription(this.ring, delivery);
    if (opened === undefined) {
      // The key is missing or a value was modified: retry later (a restored key fixes it), never send, never say why.
      if (isDead(delivery.createdAtMs, now + retryDelayMs(delivery.attempts))) return drop("unreadable", "secret_unreadable");
      await rescheduleDelivery(this.db, delivery.outboxId, now + retryDelayMs(delivery.attempts), "secret_unreadable");
      this.options.logger.warn({ serverId: delivery.serverPublicId, code: "ALERT_PUSH_SUBSCRIPTION_UNREADABLE" }, "a stored push subscription cannot be opened");
      return "done";
    }

    // The host, from the parsed endpoint in memory, to pause a failing push service for the rest of the tick. It is never
    // logged. An endpoint that fails the allowlist is dropped here (sendWebPush would refuse it too).
    const endpoint = parsePushEndpoint(opened.endpoint, push.allowedHosts);
    if (!endpoint.ok) return drop("endpoint_refused");
    if (pausedHosts.has(endpoint.host)) {
      await releaseDelivery(this.db, delivery.outboxId); // untried: due again next tick, the attempt given back
      return "done";
    }

    let payload: Buffer;
    try {
      payload = formatPushMessage({
        kind: delivery.event.kind as RuleKind,
        transition: delivery.event.transition as MessageTransition,
        severity: delivery.event.severity as Severity,
        subject: delivery.event.subject,
        summary: delivery.event.summary,
        serverName: delivery.serverName,
        serverPublicId: delivery.serverPublicId,
        at: delivery.event.atMs,
      });
    } catch {
      return drop("rejected", "unformattable"); // a kind or transition this build cannot word (a newer build's rows)
    }

    const outcome = await sendWebPush(
      { ...opened, payload, urgency: delivery.event.severity === "critical" && delivery.event.transition !== "resolved" ? "high" : "normal" },
      { vapid: push.vapid, allowedHosts: push.allowedHosts, fetch: this.options.fetch, now: this.options.now },
    );
    switch (outcome.kind) {
      case "sent":
        await markDeliverySent(this.db, delivery.outboxId);
        await markSubscriptionSuccess(this.db, delivery.subscriptionId);
        log("sent");
        return "done";
      case "retry": {
        // A rate limit, a hang or a network failure is the push service's, not this subscription's: skip its host for
        // the rest of the tick so one bad service cannot eat the whole batch. A 5xx is per request: no pause.
        if (outcome.code !== "server_error") pausedHosts.add(endpoint.host);
        const at = now + retryDelayMs(delivery.attempts, outcome.retryAfterMs);
        if (isDead(delivery.createdAtMs, at)) return drop("expired");
        await rescheduleDelivery(this.db, delivery.outboxId, at, outcome.code);
        log(outcome.code);
        return outcome.code === "rate_limited" ? "paused" : "done";
      }
      case "gone": {
        // RFC 8030 section 7.3: the subscription expired or the user revoked it. Deleting it deletes its outbox rows.
        const deleted = await withTransaction(this.db, async (client) => {
          const removed = await deleteGoneSubscription(client, delivery.subscriptionId);
          if (removed) {
            await recordAuditEvent(client, {
              action: "alerts.push.subscription_gone",
              serverId: delivery.serverId,
              detail: { subscriptionId: delivery.subscriptionId, status: outcome.status },
            });
          }
          return removed;
        });
        this.options.metrics.counter("satis.alerts.push.dropped", { server: delivery.serverPublicId, reason: "gone" });
        log(deleted ? "subscription_gone" : "subscription_already_gone");
        return "paused";
      }
      case "rejected":
        return outcome.code === "endpoint_refused" ? drop("endpoint_refused") : drop("rejected", outcome.code);
    }
  }
}
