import { MAX_PUSH_SUBSCRIPTIONS_PER_USER } from "@satisfactory-dash/shared";
import type { PushConfigResponse, PushOptInResponse, PushSubscribeRequest, PushSubscribeResponse } from "@satisfactory-dash/shared";
import { ApiFailure, BadRequestError, RateLimitedError, ServerNotFoundError } from "../../../platform/errorResponse.js";
import { recordAuditEvent } from "../../../platform/audit/auditRepository.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { orUnavailable } from "./alertsService.js";
import type { AlertDeliveryMode } from "../config.js";
import type { PushConfig } from "../pushConfig.js";
import { getServerUuid, lockServer } from "../repositories/apiRepository.js";
import {
  addPushOptIn,
  countSubscriptions,
  deleteOwnSubscription,
  deleteGoneSubscription,
  findSubscriptionByHash,
  getPushOptIn,
  getSealedOwnSubscription,
  insertSubscription,
  lockUserPush,
  markSubscriptionSuccess,
  removePushOptIn,
  replaceSubscriptionKeys,
  type SealedPushFields,
} from "../repositories/pushRepository.js";
import { formatPushTestMessage } from "./alertMessage.js";
import { parsePushEndpoint } from "./pushEndpoint.js";
import { openPushSubscription, pushFieldContext, sendWebPush, type PushSendOutcome } from "./pushSender.js";

/**
 * ADR-0044 (#348), task 348-1: web push subscriptions and the per-server opt-in. Task 348-2: `test` really sends one
 * fixed notification (no game text) and answers a stable code; a 404/410 from the push service deletes the subscription.
 *
 * The endpoint, p256dh and auth are secrets. They are sealed here (platform/secrets, bound to the user and the field),
 * stored sealed, and appear in no response, no log line and no audit row: an audit event carries ids and codes only. A
 * refused endpoint is a stable `reason`, never the URL. Every write runs in ONE transaction with its audit event.
 */
export interface PushService {
  config(): PushConfigResponse;
  /** `created` is false for an idempotent repeat of the same endpoint (the route answers 200 instead of 201). */
  subscribe(userId: string, body: PushSubscribeRequest): Promise<{ created: boolean; subscription: PushSubscribeResponse }>;
  unsubscribe(userId: string, subscriptionId: string): Promise<{ deleted: true }>;
  test(userId: string, subscriptionId: string): Promise<{ ok: true } | { ok: false; code: string }>;
  /** The caller's own opt-in for this server (public id). The membership check has already passed. */
  getOptIn(serverId: string, userId: string): Promise<PushOptInResponse>;
  setOptIn(serverId: string, userId: string, optedIn: boolean): Promise<PushOptInResponse>;
}

export interface PushServiceDeps {
  db: Queryable & Parameters<typeof withTransaction>[0];
  /** Null when SERVER_SECRETS_KEY is not set: push cannot store anything then, so it is disabled. */
  ring: SecretsKeyring | null;
  mode: AlertDeliveryMode;
  config: PushConfig;
  testLimiter?: UserRateLimiter;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  now?: () => number;
}

const subscriptionNotFound = (): ApiFailure => new ApiFailure("not_found", "That push subscription was not found");
const pushDisabled = (): ApiFailure => new ApiFailure("push_disabled", "Push notifications are not enabled on this backend");

/** The test send's answer codes (the contract's code is an open string: clients handle unknown ones generically). */
type TestCode = "sent" | "subscription_gone" | "rate_limited" | "unavailable" | "rejected" | "secret_unreadable";

function testCodeOf(outcome: PushSendOutcome): TestCode {
  switch (outcome.kind) {
    case "sent":
      return "sent";
    case "gone":
      return "subscription_gone";
    case "retry":
      return outcome.code === "rate_limited" ? "rate_limited" : "unavailable";
    case "rejected":
      return "rejected";
  }
}

const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function createPushService(deps: PushServiceDeps): PushService {
  const { db, ring, config } = deps;
  const testLimiter = deps.testLimiter ?? new UserRateLimiter({ max: 5, windowMs: 60_000 });
  const now = deps.now ?? Date.now;
  /** `ALERT_DELIVERY=on` and VAPID configured (and a keyring to seal with). */
  const enabled = deps.mode === "on" && config.vapid !== null && ring !== null;

  const requireEnabled = (): SecretsKeyring => {
    if (!enabled || ring === null) throw pushDisabled();
    return ring;
  };

  const seal = (keyring: SecretsKeyring, userId: string, endpoint: string, keys: PushSubscribeRequest["keys"]): SealedPushFields => {
    const endpointSealed = keyring.seal(endpoint, pushFieldContext(userId, "endpoint"));
    const p256dhSealed = keyring.seal(keys.p256dh, pushFieldContext(userId, "p256dh"));
    const authSealed = keyring.seal(keys.auth, pushFieldContext(userId, "auth"));
    return { keyId: endpointSealed.keyId, endpointEnc: endpointSealed.data, p256dhEnc: p256dhSealed.data, authEnc: authSealed.data };
  };

  const audit = (client: Queryable, actorUserId: string, action: string, detail: Record<string, unknown>, serverId?: string) =>
    recordAuditEvent(client, { action, actorUserId, ...(serverId !== undefined && { serverId }), detail });

  return {
    config() {
      return enabled && config.vapid !== null ? { enabled: true, vapidPublicKey: config.vapid.publicKey } : { enabled: false };
    },

    subscribe: async (userId, body) => {
      const keyring = requireEnabled();
      const endpoint = parsePushEndpoint(body.endpoint, config.allowedHosts);
      if (!endpoint.ok) {
        throw new ApiFailure("push_endpoint_invalid", "That push subscription endpoint is not accepted", endpoint.reason);
      }
      const sealed = seal(keyring, userId, endpoint.url, body.keys);
      return orUnavailable(() =>
        withTransaction(db, async (client) => {
          await lockUserPush(client, userId);
          const existing = await findSubscriptionByHash(client, userId, endpoint.hash);
          if (existing !== undefined) {
            // Idempotent: the same endpoint is the same subscription. The keys are replaced in case the browser re-subscribed.
            await replaceSubscriptionKeys(client, userId, existing.id, sealed);
            return { created: false, subscription: { id: existing.id, createdAt: existing.createdAt.toISOString() } };
          }
          if ((await countSubscriptions(client, userId)) >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
            throw new BadRequestError(`You can have at most ${MAX_PUSH_SUBSCRIPTIONS_PER_USER} devices with push notifications; remove one first`);
          }
          const created = await insertSubscription(client, { userId, sealed, host: endpoint.host, endpointHash: endpoint.hash });
          await audit(client, userId, "alerts.push.subscribed", { subscriptionId: created.id, host: endpoint.host });
          return { created: true, subscription: { id: created.id, createdAt: created.createdAt.toISOString() } };
        }),
      );
    },

    unsubscribe: (userId, subscriptionId) =>
      orUnavailable(() =>
        withTransaction(db, async (client) => {
          // Not a uuid is the same 404 as someone else's: the answer never says which.
          if (!isUuid(subscriptionId) || !(await deleteOwnSubscription(client, userId, subscriptionId))) throw subscriptionNotFound();
          await audit(client, userId, "alerts.push.unsubscribed", { subscriptionId });
          return { deleted: true as const };
        }),
      ),

    test: async (userId, subscriptionId) => {
      const keyring = requireEnabled();
      const vapid = config.vapid;
      if (vapid === null) throw pushDisabled();
      const wait = testLimiter.hit(userId);
      if (wait > 0) throw new RateLimitedError(wait, "Too many test notifications. Try again shortly.");
      // Not a uuid is the same 404 as someone else's.
      const sealed = isUuid(subscriptionId) ? await orUnavailable(() => getSealedOwnSubscription(db, userId, subscriptionId)) : undefined;
      if (sealed === undefined) throw subscriptionNotFound();
      // 348-2: a real send, outside any transaction (a slow push service must not hold a connection), then the outcome
      // and the audit row in one. The answer is a stable code only, like the Discord test.
      const opened = openPushSubscription(keyring, sealed);
      const code: TestCode =
        opened === undefined
          ? "secret_unreadable"
          : testCodeOf(
              await sendWebPush(
                { ...opened, payload: formatPushTestMessage(now()), urgency: "normal" },
                { vapid, allowedHosts: config.allowedHosts, fetch: deps.fetch, now },
              ),
            );
      return orUnavailable(() =>
        withTransaction(db, async (client) => {
          if (code === "sent") await markSubscriptionSuccess(client, subscriptionId);
          if (code === "subscription_gone" && (await deleteGoneSubscription(client, subscriptionId))) {
            await audit(client, userId, "alerts.push.subscription_gone", { subscriptionId, via: "test" });
          }
          await audit(client, userId, "alerts.push.tested", { subscriptionId, outcome: code });
          return code === "sent" ? { ok: true as const } : { ok: false as const, code };
        }),
      );
    },

    getOptIn: (serverId, userId) =>
      orUnavailable(async () => {
        const serverUuid = await getServerUuid(db, serverId);
        if (serverUuid === undefined) throw new ServerNotFoundError();
        return { optedIn: await getPushOptIn(db, serverUuid, userId) };
      }),

    setOptIn: async (serverId, userId, optedIn) => {
      // Withdrawing is never blocked, like unsubscribing a device: only opting IN needs push switched on.
      if (optedIn) requireEnabled();
      return orUnavailable(() =>
        withTransaction(db, async (client) => {
          const serverUuid = await lockServer(client, serverId);
          if (serverUuid === undefined) throw new ServerNotFoundError();
          // Audited only when something changed, so repeating the request leaves one row.
          const changed = optedIn ? await addPushOptIn(client, serverUuid, userId) : await removePushOptIn(client, serverUuid, userId);
          if (changed) await audit(client, userId, optedIn ? "alerts.push.opt_in" : "alerts.push.opt_out", {}, serverUuid);
          return { optedIn };
        }),
      );
    },
  };
}
