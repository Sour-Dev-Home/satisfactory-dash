import { z } from "zod";
import { parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";
import { parseDiscordWebhookUrl, type WebhookRejection } from "../services/discordWebhook.js";

/**
 * ADR-0027 decision 5: destinations (the encrypted webhook) and the transactional outbox. Every SQL text is a constant
 * and values only travel as parameters. The webhook URL is a bearer secret: it is sealed with the secrets keyring
 * (AES-256-GCM) bound to the SERVER and the kind (`alerts:<server uuid>:discord`), so a value copied to another row
 * fails to open; it is validated against the allowlist before it is sealed; only its last 4 characters are readable
 * without the key; and nothing here ever returns it except `openWebhook`, whose only caller is the sender.
 */

export type DisabledReason = "webhook_gone" | "invalid_url" | "manual";

/** The context bound into the ciphertext: the server's internal id and the destination kind. */
export const webhookContext = (serverId: string): string => `alerts:${serverId}:discord`;

const DueRowSchema = z.object({
  outbox_id: z.string(),
  attempts: z.number().int(),
  created_ms: z.number(),
  destination_id: z.string(),
  webhook_enc: z.instanceof(Buffer),
  key_id: z.string(),
  server_uuid: z.string(),
  server_public_id: z.string(),
  server_name: z.string(),
  kind: z.string(),
  severity: z.string(),
  subject: z.string(),
  transition: z.string(),
  at_ms: z.number(),
  summary: z.record(z.string(), z.unknown()),
});

const SummaryRowSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  last4: z.string(),
  disabled_reason: z.string().nullable(),
});
const ServerIdSchema = z.object({ id: z.string() });
const SealedRowSchema = z.object({ id: z.string(), server_uuid: z.string(), webhook_enc: z.instanceof(Buffer), key_id: z.string(), enabled: z.boolean() });

export interface DueDelivery {
  outboxId: string;
  /** Attempts made including this one. */
  attempts: number;
  createdAtMs: number;
  destinationId: string;
  /** The server's internal id: part of the encryption context of its webhook. */
  serverId: string;
  serverPublicId: string;
  serverName: string;
  keyId: string;
  webhookEnc: Buffer;
  event: { kind: string; severity: string; subject: string; transition: string; atMs: number; summary: Record<string, unknown> };
}

const SERVER_ID = `
  SELECT s.id::text AS id FROM servers.servers s WHERE s.public_id = $1 AND s.deleted_at IS NULL`;

// $1 server public id, $2 sealed bytes, $3 key id, $4 last 4. Saving again replaces the webhook and re-enables it.
const SAVE_DESTINATION = `
  INSERT INTO alerts.destinations (server_id, kind, webhook_enc, key_id, last4)
  SELECT s.id, 'discord', $2::bytea, $3, $4
  FROM servers.servers s
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  ON CONFLICT (server_id, kind) DO UPDATE SET
    webhook_enc = EXCLUDED.webhook_enc, key_id = EXCLUDED.key_id, last4 = EXCLUDED.last4,
    enabled = true, disabled_reason = NULL, updated_at = now()
  RETURNING id::text AS id`;

const DESTINATION_SUMMARY = `
  SELECT d.id::text AS id, d.enabled AS enabled, d.last4 AS last4, d.disabled_reason AS disabled_reason
  FROM alerts.destinations d
  JOIN servers.servers s ON s.id = d.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND d.kind = 'discord'`;

const DESTINATION_SEALED = `
  SELECT d.id::text AS id, d.server_id::text AS server_uuid, d.webhook_enc AS webhook_enc, d.key_id AS key_id, d.enabled AS enabled
  FROM alerts.destinations d
  JOIN servers.servers s ON s.id = d.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND d.kind = 'discord'`;

const DISABLE_DESTINATION = `
  UPDATE alerts.destinations SET enabled = false, disabled_reason = $2, updated_at = now() WHERE id = $1::uuid`;
const DEAD_FOR_DESTINATION = `
  UPDATE alerts.outbox SET status = 'dead', last_error = $2 WHERE destination_id = $1::uuid AND status = 'pending'`;

// $1 how many, $2 lease seconds. One statement: pick due rows of ENABLED destinations, lock them (SKIP LOCKED, so two
// senders never take the same row), push their due time out by the lease and count the attempt; then read the details.
const CLAIM_DUE = `
  WITH due AS (
    SELECT o.id
    FROM alerts.outbox o
    JOIN alerts.destinations d ON d.id = o.destination_id AND d.enabled
    JOIN servers.servers sv ON sv.id = d.server_id AND sv.deleted_at IS NULL
    WHERE o.status = 'pending' AND o.next_attempt_at <= now()
    ORDER BY o.next_attempt_at, o.id
    LIMIT $1::int
    FOR UPDATE OF o SKIP LOCKED),
  claimed AS (
    UPDATE alerts.outbox o
    SET attempts = o.attempts + 1, next_attempt_at = now() + make_interval(secs => $2::double precision)
    FROM due WHERE o.id = due.id
    RETURNING o.id, o.event_id, o.destination_id, o.attempts, o.created_at)
  SELECT c.id::text AS outbox_id, c.attempts AS attempts, floor(extract(epoch FROM c.created_at) * 1000)::float8 AS created_ms,
         d.id::text AS destination_id, d.webhook_enc AS webhook_enc, d.key_id AS key_id,
         s.id::text AS server_uuid, s.public_id AS server_public_id, s.display_name AS server_name,
         e.kind AS kind, e.severity AS severity, e.subject AS subject, e.transition AS transition,
         floor(extract(epoch FROM e.at) * 1000)::float8 AS at_ms, e.summary AS summary
  FROM claimed c
  JOIN alerts.destinations d ON d.id = c.destination_id
  JOIN alerts.alert_events e ON e.id = c.event_id
  JOIN servers.servers s ON s.id = e.server_id
  ORDER BY c.id`;

const MARK_SENT = `UPDATE alerts.outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1::bigint AND status = 'pending'`;
const RESCHEDULE = `
  UPDATE alerts.outbox SET next_attempt_at = to_timestamp($2::float8 / 1000.0), last_error = $3
  WHERE id = $1::bigint AND status = 'pending'`;
const MARK_DEAD = `UPDATE alerts.outbox SET status = 'dead', last_error = $2 WHERE id = $1::bigint AND status = 'pending'`;

export type SaveDestinationResult = { ok: true; destinationId: string; last4: string } | { ok: false; code: WebhookRejection | "server_not_found" };

/** Validates, seals and stores a server's Discord webhook (replacing an earlier one, and re-enabling the destination). */
export async function saveDiscordDestination(
  db: Queryable,
  ring: SecretsKeyring,
  serverPublicId: string,
  rawUrl: unknown,
): Promise<SaveDestinationResult> {
  const parsed = parseDiscordWebhookUrl(rawUrl);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  const server = parseRows(ServerIdSchema, (await db.query(SERVER_ID, [serverPublicId])).rows, "alerts.serverId")[0];
  if (server === undefined) return { ok: false, code: "server_not_found" };
  const sealed = ring.seal(parsed.url, webhookContext(server.id));
  const saved = parseRows(ServerIdSchema, (await db.query(SAVE_DESTINATION, [serverPublicId, sealed.data, sealed.keyId, parsed.last4])).rows, "alerts.saveDestination")[0];
  if (saved === undefined) return { ok: false, code: "server_not_found" };
  return { ok: true, destinationId: saved.id, last4: parsed.last4 };
}

/** What may be shown about a server's destination: whether it works and the last 4 characters. Never the URL. */
export async function getDestinationSummary(
  db: Queryable,
  serverPublicId: string,
): Promise<{ id: string; enabled: boolean; last4: string; disabledReason: string | null } | undefined> {
  const row = parseRows(SummaryRowSchema, (await db.query(DESTINATION_SUMMARY, [serverPublicId])).rows, "alerts.destinationSummary")[0];
  return row === undefined ? undefined : { id: row.id, enabled: row.enabled, last4: row.last4, disabledReason: row.disabled_reason };
}

/** The decrypted URL of a server's destination, for the sender only. Undefined when there is none or it cannot be opened. */
export async function openServerWebhook(
  db: Queryable,
  ring: SecretsKeyring,
  serverPublicId: string,
): Promise<{ destinationId: string; url: string; enabled: boolean } | undefined> {
  const row = parseRows(SealedRowSchema, (await db.query(DESTINATION_SEALED, [serverPublicId])).rows, "alerts.destinationSealed")[0];
  if (row === undefined) return undefined;
  const url = openWebhook(ring, row.server_uuid, row.key_id, row.webhook_enc);
  return url === undefined ? undefined : { destinationId: row.id, url, enabled: row.enabled };
}

/** Decrypts a stored webhook; undefined (never a throw, never the value in an error) when it cannot be opened. */
export function openWebhook(ring: SecretsKeyring, serverUuid: string, keyId: string, data: Buffer): string | undefined {
  try {
    return ring.open(keyId, data, webhookContext(serverUuid));
  } catch {
    return undefined;
  }
}

/** Switches a destination off and gives up on its pending deliveries, in one transaction. */
export async function disableDestination(
  pool: Parameters<typeof withTransaction>[0],
  destinationId: string,
  reason: DisabledReason,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query(DISABLE_DESTINATION, [destinationId, reason]);
    await client.query(DEAD_FOR_DESTINATION, [destinationId, reason]);
  });
}

/** Claims up to `limit` due deliveries (leased for `leaseSeconds`); each call counts an attempt for what it returns. */
export async function claimDueDeliveries(db: Queryable, limit: number, leaseSeconds: number): Promise<DueDelivery[]> {
  const rows = parseRows(DueRowSchema, (await db.query(CLAIM_DUE, [limit, leaseSeconds])).rows, "alerts.claimDue");
  return rows.map((row) => ({
    outboxId: row.outbox_id,
    attempts: row.attempts,
    createdAtMs: row.created_ms,
    destinationId: row.destination_id,
    serverId: row.server_uuid,
    serverPublicId: row.server_public_id,
    serverName: row.server_name,
    keyId: row.key_id,
    webhookEnc: row.webhook_enc,
    event: { kind: row.kind, severity: row.severity, subject: row.subject, transition: row.transition, atMs: row.at_ms, summary: row.summary },
  }));
}

export const markDeliverySent = (db: Queryable, outboxId: string): Promise<unknown> => db.query(MARK_SENT, [outboxId]);
export const rescheduleDelivery = (db: Queryable, outboxId: string, atMs: number, code: string): Promise<unknown> =>
  db.query(RESCHEDULE, [outboxId, atMs, code.slice(0, 40)]);
export const markDeliveryDead = (db: Queryable, outboxId: string, code: string): Promise<unknown> => db.query(MARK_DEAD, [outboxId, code.slice(0, 40)]);
