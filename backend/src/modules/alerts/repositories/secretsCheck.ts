import { z } from "zod";
import { parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { timedQuery } from "../../../platform/db/timedQuery.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";
import { openPushSubscription } from "../services/pushSender.js";
import { openWebhook } from "./deliveryRepository.js";

/**
 * ADR-0066 PR 10a: what `npm run admin -- verify-secrets` (the restore drill) opens now that the retired
 * `servers.server_connections` is no longer read. Every value `SERVER_SECRETS_KEY` seals: the Discord webhooks
 * (`alerts.destinations`) and the web-push subscriptions (`alerts.push_subscriptions`). It reports counts and the ids and
 * key ids of rows that cannot be opened, never a value.
 */

const SEALED_DESTINATIONS = `
  SELECT id::text AS id, server_id::text AS server_uuid, key_id, webhook_enc
  FROM alerts.destinations ORDER BY id`;

const SEALED_SUBSCRIPTIONS = `
  SELECT id::text AS id, user_id::text AS user_id, key_id, endpoint_enc, p256dh_enc, auth_enc
  FROM alerts.push_subscriptions ORDER BY id`;

const DestinationRowSchema = z.object({ id: z.string(), server_uuid: z.string(), key_id: z.string(), webhook_enc: z.instanceof(Buffer) });
const SubscriptionRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  key_id: z.string(),
  endpoint_enc: z.instanceof(Buffer),
  p256dh_enc: z.instanceof(Buffer),
  auth_enc: z.instanceof(Buffer),
});

/** A sealed row the ring could not open: its row id and key id only. */
export interface UnreadableSecret {
  id: string;
  keyId: string;
}

export interface SecretsCheckTable {
  opened: number;
  unreadable: UnreadableSecret[];
}

export interface SecretsCheck {
  destinations: SecretsCheckTable;
  pushSubscriptions: SecretsCheckTable;
}

/** Opens every sealed row with `ring` (null: none can be opened). Never throws on a row it cannot open. */
export async function checkStoredSecrets(db: Queryable, ring: SecretsKeyring | null): Promise<SecretsCheck> {
  const destinations = parseRows(
    DestinationRowSchema,
    (await timedQuery(db, "alerts.secretsCheck.destinations", SEALED_DESTINATIONS)).rows,
    "alerts.secretsCheck.destinations",
  );
  const subscriptions = parseRows(
    SubscriptionRowSchema,
    (await timedQuery(db, "alerts.secretsCheck.pushSubscriptions", SEALED_SUBSCRIPTIONS)).rows,
    "alerts.secretsCheck.pushSubscriptions",
  );
  const result: SecretsCheck = { destinations: { opened: 0, unreadable: [] }, pushSubscriptions: { opened: 0, unreadable: [] } };
  for (const row of destinations) {
    const url = ring === null ? undefined : openWebhook(ring, row.server_uuid, row.key_id, row.webhook_enc);
    if (url === undefined) result.destinations.unreadable.push({ id: row.id, keyId: row.key_id });
    else result.destinations.opened += 1;
  }
  for (const row of subscriptions) {
    const opened =
      ring === null
        ? undefined
        : openPushSubscription(ring, { userId: row.user_id, keyId: row.key_id, endpointEnc: row.endpoint_enc, p256dhEnc: row.p256dh_enc, authEnc: row.auth_enc });
    if (opened === undefined) result.pushSubscriptions.unreadable.push({ id: row.id, keyId: row.key_id });
    else result.pushSubscriptions.opened += 1;
  }
  return result;
}
