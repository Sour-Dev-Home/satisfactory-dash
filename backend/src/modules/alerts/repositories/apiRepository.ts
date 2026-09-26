import { z } from "zod";
import { parseOne, parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";

/**
 * ADR-0027 PR 7b: the SQL behind the alerts API (rules, the alert log, status and mute). EVERY statement is scoped by
 * the server's public id (the `:serverId` the membership check already passed), never by a rule id alone, so a rule id
 * from another server matches nothing (no IDOR). The functions take a `Queryable`, so a caller can run several of them
 * in one transaction.
 */

const RuleRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  params: z.record(z.string(), z.unknown()),
  for_seconds: z.number().int(),
  clear_seconds: z.number().int(),
  repeat_seconds: z.number().int(),
  severity: z.string(),
  enabled: z.boolean(),
  preset: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
});

export interface ApiRuleRow {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  forSeconds: number;
  clearSeconds: number;
  repeatSeconds: number;
  severity: string;
  enabled: boolean;
  preset: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const toRule = (row: z.output<typeof RuleRowSchema>): ApiRuleRow => ({
  id: row.id,
  kind: row.kind,
  params: row.params,
  forSeconds: row.for_seconds,
  clearSeconds: row.clear_seconds,
  repeatSeconds: row.repeat_seconds,
  severity: row.severity,
  enabled: row.enabled,
  preset: row.preset,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// SQL constants are plain templates without interpolation (sqlGuard.test.ts), so the column list is spelled out each time.
const SERVER_UUID = `SELECT s.id::text AS id FROM servers.servers s WHERE s.public_id = $1 AND s.deleted_at IS NULL`;
// The row lock serialises the writes of one server, so the cap and the one-rule-per-item check cannot be raced past.
// FOR NO KEY UPDATE, not FOR UPDATE: the latter conflicts with the FOR KEY SHARE that every foreign-key insert takes on
// the parent row (the evaluator's alert_events / alert_state writes), which could deadlock with it; this one does not.
const LOCK_SERVER = `SELECT s.id::text AS id FROM servers.servers s WHERE s.public_id = $1 AND s.deleted_at IS NULL FOR NO KEY UPDATE`;

const LIST_RULES = `
  SELECT r.id::text AS id, r.kind AS kind, r.params AS params, r.for_seconds AS for_seconds, r.clear_seconds AS clear_seconds,
         r.repeat_seconds AS repeat_seconds, r.severity AS severity, r.enabled AS enabled, r.preset AS preset,
         r.created_at AS created_at, r.updated_at AS updated_at
  FROM alerts.rules r
  JOIN servers.servers s ON s.id = r.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  ORDER BY r.preset DESC, r.created_at,
           array_position(ARRAY['power_outage', 'fuse_trip', 'stopped_machines', 'server_unreachable', 'production_below_target'], r.kind), r.id`;
const GET_RULE = `
  SELECT r.id::text AS id, r.kind AS kind, r.params AS params, r.for_seconds AS for_seconds, r.clear_seconds AS clear_seconds,
         r.repeat_seconds AS repeat_seconds, r.severity AS severity, r.enabled AS enabled, r.preset AS preset,
         r.created_at AS created_at, r.updated_at AS updated_at
  FROM alerts.rules r
  JOIN servers.servers s ON s.id = r.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND r.id = $2::uuid`;
const GET_RULE_FOR_UPDATE = `
  SELECT r.id::text AS id, r.kind AS kind, r.params AS params, r.for_seconds AS for_seconds, r.clear_seconds AS clear_seconds,
         r.repeat_seconds AS repeat_seconds, r.severity AS severity, r.enabled AS enabled, r.preset AS preset,
         r.created_at AS created_at, r.updated_at AS updated_at
  FROM alerts.rules r
  JOIN servers.servers s ON s.id = r.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND r.id = $2::uuid
  FOR NO KEY UPDATE OF r`;
const COUNT_RULES = `
  SELECT count(*)::int AS n FROM alerts.rules r JOIN servers.servers s ON s.id = r.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL`;
const ITEM_RULE_EXISTS = `
  SELECT count(*)::int AS n FROM alerts.rules r JOIN servers.servers s ON s.id = r.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND r.kind = 'production_below_target' AND r.params ->> 'item' = $2`;
const INSERT_RULE = `
  INSERT INTO alerts.rules (server_id, kind, params, for_seconds, clear_seconds, repeat_seconds, severity, enabled, preset)
  VALUES ($1::uuid, $2, $3::jsonb, $4, $5, $6, $7, $8, false)
  RETURNING id::text AS id`;
const UPDATE_RULE = `
  UPDATE alerts.rules SET
    enabled = $3, severity = $4, for_seconds = $5, clear_seconds = $6, repeat_seconds = $7, params = $8::jsonb, updated_at = now()
  WHERE id = $2::uuid AND server_id = (SELECT s.id FROM servers.servers s WHERE s.public_id = $1 AND s.deleted_at IS NULL)`;
// A preset is never deleted here (the caller answers preset_disable_only), and only a rule of THIS server matches.
const DELETE_RULE = `
  DELETE FROM alerts.rules
  WHERE id = $2::uuid AND NOT preset AND server_id = (SELECT s.id FROM servers.servers s WHERE s.public_id = $1 AND s.deleted_at IS NULL)
  RETURNING id::text AS id`;

const CountSchema = z.object({ n: z.number().int() });
const IdSchema = z.object({ id: z.string() });

/** The server's internal uuid, or undefined for an unknown or deleted server. */
export async function getServerUuid(db: Queryable, serverPublicId: string): Promise<string | undefined> {
  return parseRows(IdSchema, (await db.query(SERVER_UUID, [serverPublicId])).rows, "alerts.api.serverUuid")[0]?.id;
}

/** Locks the server's row for the rest of the transaction and returns its uuid (undefined when there is none). */
export async function lockServer(db: Queryable, serverPublicId: string): Promise<string | undefined> {
  return parseRows(IdSchema, (await db.query(LOCK_SERVER, [serverPublicId])).rows, "alerts.api.lockServer")[0]?.id;
}

export async function listApiRules(db: Queryable, serverPublicId: string): Promise<ApiRuleRow[]> {
  return parseRows(RuleRowSchema, (await db.query(LIST_RULES, [serverPublicId])).rows, "alerts.api.listRules").map(toRule);
}

/** One rule of THIS server; undefined when it does not exist here (including a rule of another server). */
export async function getApiRule(db: Queryable, serverPublicId: string, ruleId: string, options: { forUpdate?: boolean } = {}): Promise<ApiRuleRow | undefined> {
  const rows = parseRows(RuleRowSchema, (await db.query(options.forUpdate ? GET_RULE_FOR_UPDATE : GET_RULE, [serverPublicId, ruleId])).rows, "alerts.api.getRule");
  return rows[0] === undefined ? undefined : toRule(rows[0]);
}

export async function countRules(db: Queryable, serverPublicId: string): Promise<number> {
  return parseOne(CountSchema, (await db.query(COUNT_RULES, [serverPublicId])).rows, "alerts.api.countRules").n;
}

export async function itemRuleExists(db: Queryable, serverPublicId: string, item: string): Promise<boolean> {
  return parseOne(CountSchema, (await db.query(ITEM_RULE_EXISTS, [serverPublicId, item])).rows, "alerts.api.itemRuleExists").n > 0;
}

export interface NewRule {
  kind: string;
  params: Record<string, unknown>;
  forSeconds: number;
  clearSeconds: number;
  repeatSeconds: number;
  severity: string;
  enabled: boolean;
}

/** Inserts a (non-preset) rule for the server with this uuid and returns its id. */
export async function insertRule(db: Queryable, serverUuid: string, rule: NewRule): Promise<string> {
  const result = await db.query(INSERT_RULE, [serverUuid, rule.kind, JSON.stringify(rule.params), rule.forSeconds, rule.clearSeconds, rule.repeatSeconds, rule.severity, rule.enabled]);
  return parseOne(IdSchema, result.rows, "alerts.api.insertRule").id;
}

/** Writes every mutable field of a rule of THIS server (the caller merged the patch into the current values). */
export async function updateRule(db: Queryable, serverPublicId: string, ruleId: string, rule: Omit<NewRule, "kind">): Promise<void> {
  await db.query(UPDATE_RULE, [serverPublicId, ruleId, rule.enabled, rule.severity, rule.forSeconds, rule.clearSeconds, rule.repeatSeconds, JSON.stringify(rule.params)]);
}

/** Deletes a non-preset rule of THIS server (its persisted states cascade); false when nothing matched. */
export async function deleteRule(db: Queryable, serverPublicId: string, ruleId: string): Promise<boolean> {
  return (await db.query(DELETE_RULE, [serverPublicId, ruleId])).rows.length > 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// The alert log
// ---------------------------------------------------------------------------------------------------------------------

const EventRowSchema = z.object({
  id: z.string(),
  at: z.date(),
  rule_id: z.string().nullable(),
  kind: z.string(),
  severity: z.string(),
  subject: z.string(),
  transition: z.string(),
  summary: z.record(z.string(), z.unknown()),
});

export interface ApiEventRow {
  id: string;
  at: Date;
  ruleId: string | null;
  kind: string;
  severity: string;
  subject: string;
  transition: string;
  summary: Record<string, unknown>;
}

// $1 server public id, $2 the cursor (an event id, or null for the newest), $3 how many rows to read.
const LIST_EVENTS = `
  SELECT e.id::text AS id, e.at AS at, e.rule_id::text AS rule_id, e.kind AS kind, e.severity AS severity,
         e.subject AS subject, e.transition AS transition, e.summary AS summary
  FROM alerts.alert_events e
  JOIN servers.servers s ON s.id = e.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND ($2::bigint IS NULL OR e.id < $2::bigint)
  ORDER BY e.id DESC
  LIMIT $3::int`;

/** Newest first. Reads one row more than `limit` so the caller knows whether another page exists. */
export async function listEvents(db: Queryable, serverPublicId: string, options: { limit: number; before?: string }): Promise<{ events: ApiEventRow[]; hasMore: boolean }> {
  const rows = parseRows(EventRowSchema, (await db.query(LIST_EVENTS, [serverPublicId, options.before ?? null, options.limit + 1])).rows, "alerts.api.listEvents");
  return {
    events: rows.slice(0, options.limit).map((row) => ({
      id: row.id,
      at: row.at,
      ruleId: row.rule_id,
      kind: row.kind,
      severity: row.severity,
      subject: row.subject,
      transition: row.transition,
      summary: row.summary,
    })),
    hasMore: rows.length > options.limit,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Status and mute
// ---------------------------------------------------------------------------------------------------------------------

const FiringRowSchema = z.object({ rule_id: z.string(), kind: z.string(), subject: z.string(), severity: z.string(), since: z.date() });
export interface ApiFiringRow {
  ruleId: string;
  kind: string;
  subject: string;
  severity: string;
  since: Date;
}

// A small, indexed read (the bell polls it): the firing states of this server's ENABLED rules, oldest first, capped.
const LIST_FIRING = `
  SELECT r.id::text AS rule_id, r.kind AS kind, st.subject AS subject, r.severity AS severity, COALESCE(st.since, st.updated_at) AS since
  FROM alerts.alert_state st
  JOIN alerts.rules r ON r.id = st.rule_id
  JOIN servers.servers s ON s.id = r.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND r.enabled AND st.phase = 'firing'
  ORDER BY COALESCE(st.since, st.updated_at), r.id, st.subject
  LIMIT 100`;

export async function listFiring(db: Queryable, serverPublicId: string): Promise<ApiFiringRow[]> {
  return parseRows(FiringRowSchema, (await db.query(LIST_FIRING, [serverPublicId])).rows, "alerts.api.listFiring").map((row) => ({
    ruleId: row.rule_id,
    kind: row.kind,
    subject: row.subject,
    severity: row.severity,
    since: row.since,
  }));
}

const MuteRowSchema = z.object({ muted_until: z.date() });
const GET_MUTE = `
  SELECT m.muted_until AS muted_until
  FROM alerts.server_mutes m JOIN servers.servers s ON s.id = m.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND m.muted_until > now()`;
const SET_MUTE = `
  INSERT INTO alerts.server_mutes (server_id, muted_until)
  SELECT s.id, $2::timestamptz FROM servers.servers s WHERE s.public_id = $1 AND s.deleted_at IS NULL
  ON CONFLICT (server_id) DO UPDATE SET muted_until = EXCLUDED.muted_until, updated_at = now()
  RETURNING muted_until`;
const CLEAR_MUTE = `
  DELETE FROM alerts.server_mutes
  WHERE server_id = (SELECT s.id FROM servers.servers s WHERE s.public_id = $1 AND s.deleted_at IS NULL)`;

/** When the server's alerts are muted until, or undefined when there is no mute or it has passed. */
export async function getMute(db: Queryable, serverPublicId: string): Promise<Date | undefined> {
  return parseRows(MuteRowSchema, (await db.query(GET_MUTE, [serverPublicId])).rows, "alerts.api.getMute")[0]?.muted_until;
}

export async function setMute(db: Queryable, serverPublicId: string, until: Date): Promise<Date | undefined> {
  return parseRows(MuteRowSchema, (await db.query(SET_MUTE, [serverPublicId, until])).rows, "alerts.api.setMute")[0]?.muted_until;
}

export async function clearMute(db: Queryable, serverPublicId: string): Promise<void> {
  await db.query(CLEAR_MUTE, [serverPublicId]);
}

// ---------------------------------------------------------------------------------------------------------------------
// The Discord destination (the rest is in deliveryRepository.ts)
// ---------------------------------------------------------------------------------------------------------------------

const ENABLE_DESTINATION = `
  UPDATE alerts.destinations d SET enabled = true, disabled_reason = NULL, updated_at = now()
  FROM servers.servers s
  WHERE s.id = d.server_id AND s.public_id = $1 AND s.deleted_at IS NULL AND d.kind = 'discord'
  RETURNING d.id::text AS id`;
const DELETE_DESTINATION = `
  DELETE FROM alerts.destinations d USING servers.servers s
  WHERE s.id = d.server_id AND s.public_id = $1 AND s.deleted_at IS NULL AND d.kind = 'discord'
  RETURNING d.id::text AS id`;

/** Switches the server's Discord destination on again (clearing the reason); false when there is none. */
export async function enableDestination(db: Queryable, serverPublicId: string): Promise<boolean> {
  return (await db.query(ENABLE_DESTINATION, [serverPublicId])).rows.length > 0;
}

/** Removes the server's Discord destination (its outbox rows cascade); false when there was none. */
export async function deleteDestination(db: Queryable, serverPublicId: string): Promise<boolean> {
  return (await db.query(DELETE_DESTINATION, [serverPublicId])).rows.length > 0;
}
