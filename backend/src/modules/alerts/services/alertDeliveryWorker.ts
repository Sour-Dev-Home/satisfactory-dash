import type { Logger } from "pino";
import type { BackgroundWorker } from "../../telemetry/index.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import type { withTransaction } from "../../../platform/db/transaction.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";
import {
  claimDueDeliveries,
  disableDestination,
  markDeliveryDead,
  markDeliverySent,
  openWebhook,
  rescheduleDelivery,
  type DueDelivery,
} from "../repositories/deliveryRepository.js";
import { formatAlertMessage, type MessageTransition } from "./alertMessage.js";
import { sendDiscordMessage, type SendOutcome } from "./discordSender.js";
import { isDead, retryDelayMs } from "./retryPolicy.js";
import type { RuleKind, Severity } from "./rules.js";

export type DeliveryDb = Queryable & Parameters<typeof withTransaction>[0];

export interface AlertDeliveryOptions {
  logger: Logger;
  tickMs?: number;
  /** How many deliveries one tick claims. */
  batchSize?: number;
  /** A claimed row is invisible to other senders for this long (it is retried if we crash mid-send). */
  leaseSeconds?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

const DEFAULT_TICK_MS = 10_000;
const DEFAULT_BATCH = 10;
const DEFAULT_LEASE_SECONDS = 120;
/** A 404/401 disables a destination only on a row's second attempt or later, and the recheck comes this soon after. */
const GONE_CONFIRM_ATTEMPTS = 2;
const GONE_RECHECK_MS = 60_000;

/**
 * ADR-0027 decision 5: the outbox sender. It only runs when ALERT_DELIVERY is on. Each tick claims due rows
 * (FOR UPDATE SKIP LOCKED, so two senders never take the same row), opens the destination's webhook with the secrets
 * keyring, sends, and records the outcome: `sent`; a retry with exponential backoff that honours Discord's 429
 * `retry_after`; `dead` after 24 hours or when Discord refuses the message for good; and a 404/401 DISABLES the
 * destination (and gives up on its pending rows). Delivery is at-least-once: if the process dies between Discord's
 * answer and our write, the lease expires and the message is sent again. Nothing here logs a URL, a body or an error
 * message, only stable codes.
 */
export class AlertDeliveryWorker implements BackgroundWorker {
  private readonly tickMs: number;
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly now: () => number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private failing = false;

  constructor(
    private readonly db: DeliveryDb,
    private readonly ring: SecretsKeyring,
    private readonly options: AlertDeliveryOptions,
  ) {
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH;
    this.leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.run();
    }, delayMs);
    this.timer.unref?.();
  }

  private async run(): Promise<void> {
    try {
      await this.tick();
      if (this.failing) {
        this.options.logger.info("alert delivery recovered");
        this.failing = false;
      }
    } catch {
      if (!this.failing) {
        this.failing = true;
        this.options.logger.warn({ code: "ALERT_DELIVERY_TICK_FAILED" }, "alert delivery failed; retrying next tick");
      }
    } finally {
      this.inFlight = undefined;
      this.schedule(this.tickMs);
    }
  }

  /** One pass over the due deliveries; exposed for tests. Throws when the database fails (the loop catches it). */
  async tick(): Promise<void> {
    const due = await claimDueDeliveries(this.db, this.batchSize, this.leaseSeconds);
    const pausedDestinations = new Set<string>();
    for (const delivery of due) {
      if (this.stopped) return; // shutting down: the rest keep their lease and are retried by the next process
      if (pausedDestinations.has(delivery.destinationId)) continue; // rate limited this tick: its lease runs out, then it is retried
      const outcome = await this.deliver(delivery);
      if (outcome === "paused") pausedDestinations.add(delivery.destinationId);
    }
  }

  private async deliver(delivery: DueDelivery): Promise<"done" | "paused"> {
    const now = this.now();
    const log = (code: string, extra: Record<string, unknown> = {}) =>
      this.options.logger.info(
        { serverId: delivery.serverPublicId, alert: delivery.event.kind, transition: delivery.event.transition, attempts: delivery.attempts, code, ...extra },
        "alert delivery",
      );
    if (isDead(delivery.createdAtMs, now)) {
      await markDeliveryDead(this.db, delivery.outboxId, "expired");
      log("expired");
      return "done";
    }
    const url = openWebhook(this.ring, delivery.serverId, delivery.keyId, delivery.webhookEnc);
    if (url === undefined) {
      // The key is missing or the value was modified: retry later (a restored key fixes it), never send, never say why.
      await rescheduleDelivery(this.db, delivery.outboxId, now + retryDelayMs(delivery.attempts), "secret_unreadable");
      this.options.logger.warn({ serverId: delivery.serverPublicId, code: "ALERT_DESTINATION_UNREADABLE" }, "a stored webhook cannot be opened");
      return "done";
    }
    let payload: ReturnType<typeof formatAlertMessage>;
    try {
      payload = formatAlertMessage({
        kind: delivery.event.kind as RuleKind,
        transition: delivery.event.transition as MessageTransition,
        severity: delivery.event.severity as Severity,
        subject: delivery.event.subject,
        summary: delivery.event.summary,
        serverName: delivery.serverName,
        at: delivery.event.atMs,
      });
    } catch {
      // A kind or transition this build cannot word (rows written by a newer build): give up on THIS row only, so one
      // such row never throws out of the batch and holds the others behind its lease, tick after tick.
      await markDeliveryDead(this.db, delivery.outboxId, "unformattable");
      log("unformattable");
      return "done";
    }
    const outcome: SendOutcome = await sendDiscordMessage(url, payload, { fetch: this.options.fetch });
    switch (outcome.kind) {
      case "sent":
        await markDeliverySent(this.db, delivery.outboxId);
        log("sent");
        return "done";
      case "retry": {
        const at = now + retryDelayMs(delivery.attempts, outcome.retryAfterMs);
        if (isDead(delivery.createdAtMs, at)) {
          await markDeliveryDead(this.db, delivery.outboxId, "expired");
          log("expired");
        } else {
          await rescheduleDelivery(this.db, delivery.outboxId, at, outcome.code);
          log(outcome.code);
        }
        return outcome.code === "rate_limited" ? "paused" : "done";
      }
      case "gone":
        // A 404/401 on the first sight is not believed (a proxy or edge glitch must not kill a working destination):
        // retry that row shortly and pause the destination for this tick. Only a repeat disables it.
        if (delivery.attempts < GONE_CONFIRM_ATTEMPTS) {
          await rescheduleDelivery(this.db, delivery.outboxId, now + GONE_RECHECK_MS, "webhook_gone");
          log("webhook_gone");
          return "paused";
        }
        // The webhook was deleted (404) or its token is no longer valid (401): the destination is dead.
        await disableDestination(this.db, delivery.destinationId, "webhook_gone");
        this.options.logger.warn({ serverId: delivery.serverPublicId, code: "ALERT_DESTINATION_DISABLED", status: outcome.status }, "the Discord webhook is gone; destination disabled");
        return "paused";
      case "rejected":
        await markDeliveryDead(this.db, delivery.outboxId, outcome.code);
        log(outcome.code);
        return "done";
    }
  }
}
