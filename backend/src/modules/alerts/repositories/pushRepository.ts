import { z } from "zod";
import { parseFirst } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { timedQuery } from "../../../platform/db/timedQuery.js";

/**
 * ADR-0044: web push storage (migration 1791331200000). Every SQL text is a constant, every value a parameter, and every
 * statement that reads a subscription scopes it by the OWNING user, so one user cannot reach another's row by guessing an
 * id. The endpoint, p256dh and auth arrive here already SEALED (platform/secrets, by the service); this file never sees a
 * plaintext secret. Only the sender (task 348-2) reads the sealed columns back: `getSealedOwnSubscription` for the test
 * send, and the outbox claim in deliveryRepository.ts; both hand them to the sender, which opens them in memory only.
 */

export interface SealedPushFields {
  keyId: string;
  endpointEnc: Buffer;
  p256dhEnc: Buffer;
  authEnc: Buffer;
}

const SubscriptionRowSchema = z.object({ id: z.string(), created_at: z.date() });
export interface PushSubscriptionRef {
  id: string;
  createdAt: Date;
}
const toRef = (row: z.infer<typeof SubscriptionRowSchema>): PushSubscriptionRef => ({ id: row.id, createdAt: row.created_at });

// One transaction per user at a time for the subscribe path: the count check and the insert are not racy.
const LOCK_USER = `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`;

const FIND_BY_HASH = `
  SELECT id::text AS id, created_at FROM alerts.push_subscriptions
  WHERE user_id = $1::uuid AND endpoint_hash = $2::bytea`;

const COUNT_FOR_USER = `SELECT count(*)::int AS n FROM alerts.push_subscriptions WHERE user_id = $1::uuid`;

const INSERT_SUBSCRIPTION = `
  INSERT INTO alerts.push_subscriptions (user_id, endpoint_enc, p256dh_enc, auth_enc, key_id, endpoint_host, endpoint_hash)
  VALUES ($1::uuid, $2::bytea, $3::bytea, $4::bytea, $5, $6, $7::bytea)
  RETURNING id::text AS id, created_at`;

// The same endpoint again: the keys may have changed (the browser re-subscribed), so they are replaced.
const SET_KEYS = `
  UPDATE alerts.push_subscriptions
  SET endpoint_enc = $3::bytea, p256dh_enc = $4::bytea, auth_enc = $5::bytea, key_id = $6
  WHERE id = $1::uuid AND user_id = $2::uuid`;

const DELETE_OWNED = `DELETE FROM alerts.push_subscriptions WHERE id = $1::uuid AND user_id = $2::uuid RETURNING 1 AS deleted`;
const GET_OWNED = `SELECT id::text AS id, created_at FROM alerts.push_subscriptions WHERE id = $1::uuid AND user_id = $2::uuid`;

const GET_OPT_IN = `SELECT 1 AS opted_in FROM alerts.push_optins WHERE server_id = $1::uuid AND user_id = $2::uuid`;
const SET_OPT_IN = `
  INSERT INTO alerts.push_optins (server_id, user_id) VALUES ($1::uuid, $2::uuid)
  ON CONFLICT (server_id, user_id) DO NOTHING
  RETURNING 1 AS added`;
const REMOVE_OPT_IN = `DELETE FROM alerts.push_optins WHERE server_id = $1::uuid AND user_id = $2::uuid RETURNING 1 AS removed`;

// --- 348-2, the sender: the only statements that read the sealed columns back ---------------------------------------

const GET_SEALED_OWNED = `
  SELECT id::text AS id, user_id::text AS user_id, key_id, endpoint_enc, p256dh_enc, auth_enc
  FROM alerts.push_subscriptions WHERE id = $1::uuid AND user_id = $2::uuid`;

// ADR-0044 decision 5 and #516's review: who may still receive a server's alert, read just before each send. One row
// per existing user (none once the user is deleted): still a member, still active, still opted in.
const RECIPIENT_CHECK = `
  SELECT (m.user_id IS NOT NULL) AS member, (u.status = 'active') AS active, (o.user_id IS NOT NULL) AS opted_in
  FROM identity.users u
  LEFT JOIN servers.server_members m ON m.server_id = $1::uuid AND m.user_id = u.id
  LEFT JOIN alerts.push_optins o ON o.server_id = $1::uuid AND o.user_id = u.id
  WHERE u.id = $2::uuid`;

// The push service said the subscription is gone (404/410): it is deleted, and its outbox rows with it (ON DELETE CASCADE).
const DELETE_GONE = `DELETE FROM alerts.push_subscriptions WHERE id = $1::uuid RETURNING 1 AS deleted`;
const MARK_SUCCESS = `UPDATE alerts.push_subscriptions SET last_success_at = now() WHERE id = $1::uuid`;

const SealedRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  key_id: z.string(),
  endpoint_enc: z.instanceof(Buffer),
  p256dh_enc: z.instanceof(Buffer),
  auth_enc: z.instanceof(Buffer),
});
const RecipientRowSchema = z.object({ member: z.boolean(), active: z.boolean(), opted_in: z.boolean() });

export interface SealedSubscription extends SealedPushFields {
  id: string;
  userId: string;
}

/** The user's own subscription WITH its sealed fields, for the test send only. */
export async function getSealedOwnSubscription(db: Queryable, userId: string, id: string): Promise<SealedSubscription | undefined> {
  const row = parseFirst(SealedRowSchema, (await timedQuery(db, "alerts.push.getSealedOwned", GET_SEALED_OWNED, [id, userId])).rows, "alerts.push.getSealedOwned");
  return row === undefined
    ? undefined
    : { id: row.id, userId: row.user_id, keyId: row.key_id, endpointEnc: row.endpoint_enc, p256dhEnc: row.p256dh_enc, authEnc: row.auth_enc };
}

export type RecipientVerdict = "ok" | "not_member" | "user_inactive" | "opted_out";

/** Whether `userId` may receive `serverUuid`'s alerts right now. A deleted user is `not_member`. */
export async function checkPushRecipient(db: Queryable, serverUuid: string, userId: string): Promise<RecipientVerdict> {
  const row = parseFirst(RecipientRowSchema, (await timedQuery(db, "alerts.push.recipientCheck", RECIPIENT_CHECK, [serverUuid, userId])).rows, "alerts.push.recipientCheck");
  if (row === undefined || !row.member) return "not_member";
  if (!row.active) return "user_inactive";
  return row.opted_in ? "ok" : "opted_out";
}

/** Deletes a subscription the push service reported gone; true when there was one to delete. */
export async function deleteGoneSubscription(db: Queryable, id: string): Promise<boolean> {
  return (await timedQuery(db, "alerts.push.deleteGone", DELETE_GONE, [id])).rows.length > 0;
}

export async function markSubscriptionSuccess(db: Queryable, id: string): Promise<void> {
  await timedQuery(db, "alerts.push.markSuccess", MARK_SUCCESS, [id]);
}

export async function lockUserPush(db: Queryable, userId: string): Promise<void> {
  await timedQuery(db, "alerts.push.lockUser", LOCK_USER, [`push:${userId}`]);
}

export async function findSubscriptionByHash(db: Queryable, userId: string, endpointHash: Buffer): Promise<PushSubscriptionRef | undefined> {
  const row = parseFirst(SubscriptionRowSchema, (await timedQuery(db, "alerts.push.findByHash", FIND_BY_HASH, [userId, endpointHash])).rows, "alerts.push.findByHash");
  return row === undefined ? undefined : toRef(row);
}

export async function countSubscriptions(db: Queryable, userId: string): Promise<number> {
  const row = parseFirst(z.object({ n: z.number().int() }), (await timedQuery(db, "alerts.push.count", COUNT_FOR_USER, [userId])).rows, "alerts.push.count");
  return row?.n ?? 0;
}

export async function insertSubscription(
  db: Queryable,
  input: { userId: string; sealed: SealedPushFields; host: string; endpointHash: Buffer },
): Promise<PushSubscriptionRef> {
  const { userId, sealed, host, endpointHash } = input;
  const params = [userId, sealed.endpointEnc, sealed.p256dhEnc, sealed.authEnc, sealed.keyId, host, endpointHash];
  const row = parseFirst(SubscriptionRowSchema, (await timedQuery(db, "alerts.push.insert", INSERT_SUBSCRIPTION, params)).rows, "alerts.push.insert");
  if (row === undefined) throw new Error("alerts.push.insert returned no row");
  return toRef(row);
}

export async function replaceSubscriptionKeys(db: Queryable, userId: string, id: string, sealed: SealedPushFields): Promise<void> {
  await timedQuery(db, "alerts.push.setKeys", SET_KEYS, [id, userId, sealed.endpointEnc, sealed.p256dhEnc, sealed.authEnc, sealed.keyId]);
}

/** Deletes the user's own subscription; false when there is none with that id for that user (someone else's included). */
export async function deleteOwnSubscription(db: Queryable, userId: string, id: string): Promise<boolean> {
  return (await timedQuery(db, "alerts.push.delete", DELETE_OWNED, [id, userId])).rows.length > 0;
}

export async function getOwnSubscription(db: Queryable, userId: string, id: string): Promise<PushSubscriptionRef | undefined> {
  const row = parseFirst(SubscriptionRowSchema, (await timedQuery(db, "alerts.push.getOwned", GET_OWNED, [id, userId])).rows, "alerts.push.getOwned");
  return row === undefined ? undefined : toRef(row);
}

export async function getPushOptIn(db: Queryable, serverUuid: string, userId: string): Promise<boolean> {
  return (await timedQuery(db, "alerts.push.getOptIn", GET_OPT_IN, [serverUuid, userId])).rows.length > 0;
}

/** True when the row was added (a change), false when it was already there. */
export async function addPushOptIn(db: Queryable, serverUuid: string, userId: string): Promise<boolean> {
  return (await timedQuery(db, "alerts.push.setOptIn", SET_OPT_IN, [serverUuid, userId])).rows.length > 0;
}

/** True when a row was removed (a change), false when there was none. */
export async function removePushOptIn(db: Queryable, serverUuid: string, userId: string): Promise<boolean> {
  return (await timedQuery(db, "alerts.push.removeOptIn", REMOVE_OPT_IN, [serverUuid, userId])).rows.length > 0;
}
