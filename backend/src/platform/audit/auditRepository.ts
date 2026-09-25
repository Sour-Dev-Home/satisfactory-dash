import { z } from "zod";
import { parseOne, parseRows } from "../db/rows.js";
import type { Queryable } from "../db/schemaVersion.js";

/**
 * The audit trail (ADR-0025 security review points): append-only, and satis_app has no UPDATE or
 * DELETE on the table, so a bug or a compromised backend cannot rewrite history.
 *
 * RULE for `detail`: only ids and codes. Never emails, names, tokens, cookies or any other
 * personal data. The trail is readable by operators, and keeping it free of personal data means
 * deleting an account needs no audit scrubbing (the actor is an id that simply stops resolving).
 */
export interface AuditEventInput {
  /** dot/underscore action name, e.g. "login", "logout", "revoke_all", "grant_owner". */
  action: string;
  actorUserId?: string;
  serverId?: string;
  /** A JSON object of non-secret context. */
  detail?: Record<string, unknown>;
}

const AuditEventRowSchema = z.object({
  id: z.coerce.number().int(),
  at: z.date(),
  actor_user_id: z.string().nullable(),
  server_id: z.string().nullable(),
  action: z.string(),
  detail: z.record(z.string(), z.unknown()),
});

export interface AuditEvent {
  id: number;
  at: Date;
  actorUserId: string | null;
  serverId: string | null;
  action: string;
  detail: Record<string, unknown>;
}

const toEvent = (row: z.output<typeof AuditEventRowSchema>): AuditEvent => ({
  id: row.id,
  at: row.at,
  actorUserId: row.actor_user_id,
  serverId: row.server_id,
  action: row.action,
  detail: row.detail,
});

// SQL constants are plain templates without interpolation (the SQL guard rejects "+" and ${}).
const INSERT_EVENT = `
  INSERT INTO audit.audit_events (actor_user_id, server_id, action, detail)
  VALUES ($1, $2, $3, $4::jsonb)
  RETURNING id, at, actor_user_id, server_id, action, detail`;

export async function recordAuditEvent(db: Queryable, event: AuditEventInput): Promise<AuditEvent> {
  const result = await db.query(INSERT_EVENT, [
    event.actorUserId ?? null,
    event.serverId ?? null,
    event.action,
    JSON.stringify(event.detail ?? {}),
  ]);
  return toEvent(parseOne(AuditEventRowSchema, result.rows, "audit.recordAuditEvent"));
}

const LIST_RECENT = `
  SELECT id, at, actor_user_id, server_id, action, detail
  FROM audit.audit_events
  WHERE ($1::uuid IS NULL OR server_id = $1)
  ORDER BY at DESC, id DESC
  LIMIT $2`;

/** Newest first. `limit` is clamped to 1-500. */
export async function listRecentAuditEvents(
  db: Queryable,
  options: { serverId?: string; limit?: number } = {},
): Promise<AuditEvent[]> {
  const requested = Math.trunc(options.limit ?? 50);
  // NaN survives Math.min/max and would reach Postgres as 'NaN'; treat it as the default.
  const limit = Math.min(Math.max(Number.isNaN(requested) ? 50 : requested, 1), 500);
  const result = await db.query(LIST_RECENT, [options.serverId ?? null, limit]);
  return parseRows(AuditEventRowSchema, result.rows, "audit.listRecentAuditEvents").map(toEvent);
}

// Audit retention (privacy policy: 1 year). satis_app cannot DELETE from the append-only trail; this calls
// the SECURITY DEFINER function the 1790380800000_audit_purge migration created, which deletes only events
// older than a year and returns how many.
const PURGE_EXPIRED = `SELECT audit.purge_expired_events() AS deleted`;

export async function purgeExpiredAuditEvents(db: Queryable): Promise<number> {
  const result = await db.query(PURGE_EXPIRED);
  return z.object({ deleted: z.coerce.number().int().min(0) }).parse(result.rows[0]).deleted;
}
