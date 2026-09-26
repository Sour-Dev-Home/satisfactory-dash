import { z } from "zod";
import { parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import type { AlertState } from "../services/alertStateMachine.js";
import { PRESET_RULES } from "../services/rules.js";
import type { AlertEventOut, StateWrite } from "../services/serverAlertEvaluator.js";
import { stateKey } from "../services/serverAlertEvaluator.js";

/**
 * ADR-0027 decision 4 and 5: the `alerts` schema (migration 1790640000000_alerts). Every SQL text is a constant, values
 * only travel as parameters, arrays are unpacked with unnest(), and servers are addressed by their PUBLIC id (a removed
 * server matches nothing). The state change and the alert events of one evaluation are written in ONE transaction.
 */

/** The alert log is kept this long (game data, not personal data). */
export const ALERT_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const RuleRowSchema = z.object({
  id: z.string(),
  server_public_id: z.string(),
  kind: z.string(),
  params: z.unknown(),
  for_seconds: z.number().int(),
  clear_seconds: z.number().int(),
  repeat_seconds: z.number().int(),
  severity: z.string(),
});
export type RuleRow = z.infer<typeof RuleRowSchema>;

const StateRowSchema = z.object({
  rule_id: z.string(),
  subject: z.string(),
  phase: z.enum(["ok", "pending", "firing"]),
  since_ms: z.number().nullable(),
  clear_since_ms: z.number().nullable(),
  last_notified_ms: z.number().nullable(),
  last_condition: z.boolean(),
});

const MuteRowSchema = z.object({ server_public_id: z.string(), muted_until_ms: z.number() });
const DeletedSchema = z.object({ deleted: z.number().int() });

const LIST_RULES = `
  SELECT r.id::text AS id, s.public_id AS server_public_id, r.kind AS kind, r.params AS params,
         r.for_seconds AS for_seconds, r.clear_seconds AS clear_seconds, r.repeat_seconds AS repeat_seconds,
         r.severity AS severity
  FROM alerts.rules r
  JOIN servers.servers s ON s.id = r.server_id
  WHERE r.enabled AND s.deleted_at IS NULL
  ORDER BY s.public_id, r.kind, r.id`;

const LIST_STATES = `
  SELECT st.rule_id::text AS rule_id, st.subject AS subject, st.phase AS phase,
         floor(extract(epoch FROM st.since) * 1000)::float8 AS since_ms,
         floor(extract(epoch FROM st.clear_since) * 1000)::float8 AS clear_since_ms,
         floor(extract(epoch FROM st.last_notified_at) * 1000)::float8 AS last_notified_ms,
         st.last_condition AS last_condition
  FROM alerts.alert_state st
  JOIN alerts.rules r ON r.id = st.rule_id
  JOIN servers.servers s ON s.id = r.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL`;

const LIST_MUTES = `
  SELECT s.public_id AS server_public_id, floor(extract(epoch FROM m.muted_until) * 1000)::float8 AS muted_until_ms
  FROM alerts.server_mutes m
  JOIN servers.servers s ON s.id = m.server_id
  WHERE s.deleted_at IS NULL`;

// $1 server public id, then one array per column: kind, params (json text), for, clear, repeat, severity.
const SEED_PRESETS = `
  INSERT INTO alerts.rules (server_id, kind, params, for_seconds, clear_seconds, repeat_seconds, severity, preset)
  SELECT s.id, x.kind, x.params::jsonb, x.for_seconds, x.clear_seconds, x.repeat_seconds, x.severity, true
  FROM servers.servers s,
       unnest($2::text[], $3::text[], $4::int[], $5::int[], $6::int[], $7::text[])
         AS x(kind, params, for_seconds, clear_seconds, repeat_seconds, severity)
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  ON CONFLICT (server_id, kind) WHERE preset DO NOTHING`;

// $1..$7: rule ids, subjects, phases, since / clear_since / last_notified (ms, nullable), last condition.
// A rule that was deleted meanwhile matches nothing, so its state is simply not written.
const UPSERT_STATES = `
  INSERT INTO alerts.alert_state (rule_id, subject, phase, since, clear_since, last_notified_at, last_condition, updated_at)
  SELECT r.id, x.subject, x.phase,
         to_timestamp(x.since_ms / 1000.0), to_timestamp(x.clear_since_ms / 1000.0), to_timestamp(x.last_notified_ms / 1000.0),
         x.last_condition, now()
  FROM unnest($1::uuid[], $2::text[], $3::text[], $4::float8[], $5::float8[], $6::float8[], $7::bool[])
         AS x(rule_id, subject, phase, since_ms, clear_since_ms, last_notified_ms, last_condition)
  JOIN alerts.rules r ON r.id = x.rule_id
  ON CONFLICT (rule_id, subject) DO UPDATE SET
    phase = EXCLUDED.phase, since = EXCLUDED.since, clear_since = EXCLUDED.clear_since,
    last_notified_at = EXCLUDED.last_notified_at, last_condition = EXCLUDED.last_condition, updated_at = now()`;

// $1 at (ms) and then arrays: rule ids, kinds, severities, subjects, transitions, summaries (json text).
const INSERT_EVENTS = `
  INSERT INTO alerts.alert_events (server_id, rule_id, kind, severity, subject, transition, at, summary)
  SELECT r.server_id, r.id, x.kind, x.severity, x.subject, x.transition, to_timestamp($1::float8 / 1000.0), x.summary::jsonb
  FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
         AS x(rule_id, kind, severity, subject, transition, summary)
  JOIN alerts.rules r ON r.id = x.rule_id
  RETURNING id::text AS id`;

// ADR-0027 decision 5, the transactional outbox: one row per (new event, ENABLED destination of its server), written in
// the same transaction as the events. (event_id, destination_id) is the idempotency key.
const ENQUEUE_DELIVERIES = `
  INSERT INTO alerts.outbox (event_id, destination_id)
  SELECT e.id, d.id
  FROM alerts.alert_events e
  JOIN alerts.destinations d ON d.server_id = e.server_id AND d.enabled
  JOIN servers.servers sv ON sv.id = e.server_id AND sv.deleted_at IS NULL
  WHERE e.id = ANY($1::bigint[])
  ON CONFLICT (event_id, destination_id) DO NOTHING`;

const InsertedIdSchema = z.object({ id: z.string() });

const PURGE_EVENTS = `
  WITH d AS (
    DELETE FROM alerts.alert_events
    WHERE ctid IN (SELECT ctid FROM alerts.alert_events WHERE at < $1::timestamptz LIMIT $2)
    RETURNING 1)
  SELECT count(*)::int AS deleted FROM d`;

export async function listRules(db: Queryable): Promise<RuleRow[]> {
  const result = await db.query(LIST_RULES, []);
  return parseRows(RuleRowSchema, result.rows, "alerts.listRules");
}

/** The persisted states of one server's rules, keyed by `stateKey(ruleId, subject)`. */
export async function loadStates(db: Queryable, serverPublicId: string): Promise<Map<string, AlertState>> {
  const result = await db.query(LIST_STATES, [serverPublicId]);
  const map = new Map<string, AlertState>();
  for (const row of parseRows(StateRowSchema, result.rows, "alerts.loadStates")) {
    map.set(stateKey(row.rule_id, row.subject), {
      phase: row.phase,
      since: row.since_ms,
      clearSince: row.clear_since_ms,
      lastNotifiedAt: row.last_notified_ms,
      lastCondition: row.last_condition,
    });
  }
  return map;
}

/** When each server's alerts are muted until (ms); only servers with a mute row. */
export async function loadMutes(db: Queryable): Promise<Map<string, number>> {
  const result = await db.query(LIST_MUTES, []);
  return new Map(parseRows(MuteRowSchema, result.rows, "alerts.loadMutes").map((row) => [row.server_public_id, row.muted_until_ms]));
}

/** Seeds the preset rules for one server, idempotently: running it again changes nothing. */
export async function seedPresetRules(db: Queryable, serverPublicId: string): Promise<void> {
  await db.query(SEED_PRESETS, [
    serverPublicId,
    PRESET_RULES.map((preset) => preset.kind),
    PRESET_RULES.map((preset) => JSON.stringify(preset.params)),
    PRESET_RULES.map((preset) => preset.forSeconds),
    PRESET_RULES.map((preset) => preset.clearSeconds),
    PRESET_RULES.map((preset) => preset.repeatSeconds),
    PRESET_RULES.map((preset) => preset.severity),
  ]);
}

/**
 * Stores one evaluation: the changed states AND the alert events, in ONE transaction, so an event never exists without
 * its state change (a restart reloads the state and does not fire it again) and vice versa. Throws on a database error;
 * the caller skips the tick and the evaluator (not yet committed) is unchanged.
 */
export async function writeEvaluation(
  pool: Parameters<typeof withTransaction>[0],
  input: {
    writes: readonly StateWrite[];
    events: readonly AlertEventOut[];
    nowMs: number;
    /** ALERT_DELIVERY is on: also queue each new event for every enabled destination, in the same transaction. While
     *  it is off nothing is queued, so switching it on later sends only transitions that happen after that. */
    deliver?: boolean;
  },
): Promise<void> {
  if (input.writes.length === 0 && input.events.length === 0) return;
  await withTransaction(pool, async (client) => {
    if (input.writes.length > 0) {
      const w = input.writes;
      await client.query(UPSERT_STATES, [
        w.map((write) => write.ruleId),
        w.map((write) => write.subject),
        w.map((write) => write.state.phase),
        w.map((write) => write.state.since),
        w.map((write) => write.state.clearSince),
        w.map((write) => write.state.lastNotifiedAt),
        w.map((write) => write.state.lastCondition),
      ]);
    }
    if (input.events.length > 0) {
      const e = input.events;
      const inserted = await client.query(INSERT_EVENTS, [
        input.nowMs,
        e.map((event) => event.ruleId),
        e.map((event) => event.kind),
        e.map((event) => event.severity),
        e.map((event) => event.subject),
        e.map((event) => event.transition),
        e.map((event) => JSON.stringify(event.summary)),
      ]);
      if (input.deliver === true) {
        const ids = parseRows(InsertedIdSchema, inserted.rows, "alerts.insertEvents").map((row) => row.id);
        if (ids.length > 0) await client.query(ENQUEUE_DELIVERIES, [ids]);
      }
    }
  });
}

/** Deletes alert events older than the retention, in batches; returns how many went. */
export async function purgeExpiredEvents(db: Queryable, nowMs: number, options: { batchSize?: number; maxBatches?: number } = {}): Promise<number> {
  const batchSize = options.batchSize ?? 5000;
  const maxBatches = options.maxBatches ?? 100;
  const cutoff = new Date(nowMs - ALERT_EVENT_RETENTION_MS).toISOString();
  let total = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await db.query(PURGE_EVENTS, [cutoff, batchSize]);
    const deleted = parseRows(DeletedSchema, result.rows, "alerts.purge")[0]?.deleted ?? 0;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}
