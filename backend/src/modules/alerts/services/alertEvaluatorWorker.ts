import type { Logger } from "pino";
import type { ServerDirectory } from "../../servers/index.js";
import type { BackgroundWorker, TelemetryScope } from "../../telemetry/index.js";
import { formatErrorDetail } from "../../../platform/formatErrorDetail.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import type { withTransaction } from "../../../platform/db/transaction.js";
import {
  listRules,
  loadMutes,
  loadStates,
  purgeExpiredEvents,
  seedPresetRules,
  writeEvaluation,
  type RuleRow,
} from "../repositories/alertRepository.js";
import { parseRuleParams, SEVERITIES, type Rule, type Severity } from "./rules.js";
import { ServerAlertEvaluator } from "./serverAlertEvaluator.js";

/** What the worker needs from the database: queries and transactions (a pool). */
export type AlertsDb = Queryable & Parameters<typeof withTransaction>[0];

export interface AlertEvaluatorOptions {
  logger: Logger;
  /** How often every server is evaluated. */
  tickMs?: number;
  /** How often expired alert events are purged. */
  purgeIntervalMs?: number;
  now?: () => number;
}

const DEFAULT_TICK_MS = 30_000;
const DEFAULT_PURGE_INTERVAL_MS = 10 * 60_000;

function toRule(row: RuleRow): Rule | undefined {
  const parsed = parseRuleParams(row.kind, row.params);
  if (parsed === undefined || !(SEVERITIES as readonly string[]).includes(row.severity)) return undefined;
  return {
    ...parsed,
    id: row.id,
    serverPublicId: row.server_public_id,
    forSeconds: row.for_seconds,
    clearSeconds: row.clear_seconds,
    repeatSeconds: row.repeat_seconds,
    severity: row.severity as Severity,
  };
}

/**
 * ADR-0027 decision 4: evaluates every server's alert rules every 30 seconds, from the pollers' last readings (no game
 * server call, no history query), and records the transitions in the alert log. It only runs with a database. One tick
 * is: seed the preset rules for any server not yet seeded (existing servers included), read the rules, the states and
 * the mutes, evaluate each server, and store the changed states plus the events in ONE transaction; only then does the
 * server's in-memory state advance. A tick that fails (the database is down) is logged once and skipped with no state
 * change: the next tick reproduces the same transitions. A rule whose params cannot be read is skipped with a logged
 * code and never crashes the tick. This PR only RECORDS events (delivery is PR 6, behind ALERT_DELIVERY).
 */
export class AlertEvaluatorWorker implements BackgroundWorker {
  private readonly evaluators = new Map<string, ServerAlertEvaluator>();
  private readonly seeded = new Set<string>();
  private readonly badRules = new Set<string>();
  private readonly tickMs: number;
  private readonly purgeIntervalMs: number;
  private readonly now: () => number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private lastPurgeAt: number | undefined;
  private failing = false;

  constructor(
    private readonly db: AlertsDb,
    private readonly directory: ServerDirectory<TelemetryScope>,
    private readonly options: AlertEvaluatorOptions,
  ) {
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.purgeIntervalMs = options.purgeIntervalMs ?? DEFAULT_PURGE_INTERVAL_MS;
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
        this.options.logger.info("alert evaluation recovered");
        this.failing = false;
      }
    } catch (err) {
      if (!this.failing) {
        this.failing = true;
        this.options.logger.warn({ err: formatErrorDetail(err) }, "alert evaluation failed; skipping the tick with no state change");
      }
    } finally {
      this.inFlight = undefined;
      this.schedule(this.tickMs);
    }
  }

  /** One evaluation of every server; exposed for tests. Throws when the database fails (the loop catches it). */
  async tick(): Promise<void> {
    const now = this.now();
    const servers = this.directory.list().flatMap((summary) => {
      const observations = this.directory.get(summary.id)?.telemetry.observations;
      return observations === undefined ? [] : [{ id: summary.id, observations }];
    });
    const live = new Set(servers.map((server) => server.id));
    for (const id of this.evaluators.keys()) {
      if (!live.has(id)) this.evaluators.delete(id); // the server was removed
    }

    for (const server of servers) {
      if (!this.seeded.has(server.id)) {
        await seedPresetRules(this.db, server.id);
        this.seeded.add(server.id);
      }
    }

    const rows = await listRules(this.db);
    const mutes = await loadMutes(this.db);
    const rulesByServer = new Map<string, Rule[]>();
    for (const row of rows) {
      const rule = toRule(row);
      if (rule === undefined) {
        if (!this.badRules.has(row.id)) {
          this.badRules.add(row.id);
          this.options.logger.warn({ ruleId: row.id, code: "ALERT_RULE_UNREADABLE" }, "an alert rule has params that cannot be read; it is skipped");
        }
        continue;
      }
      this.badRules.delete(row.id);
      rulesByServer.set(rule.serverPublicId, [...(rulesByServer.get(rule.serverPublicId) ?? []), rule]);
    }

    // One server's failure (a poison row, say) must not starve the servers after it: each is isolated, the first error
    // is remembered, and the tick still purges, then rethrows so the loop logs it (once per outage) as before.
    let firstError: unknown;
    let failed = false;
    for (const server of servers) {
      try {
        const rules = rulesByServer.get(server.id) ?? [];
        let evaluator = this.evaluators.get(server.id);
        if (evaluator === undefined) {
          evaluator = new ServerAlertEvaluator();
          this.evaluators.set(server.id, evaluator);
        }
        const states = await loadStates(this.db, server.id);
        const evaluation = evaluator.evaluate({
          now,
          observations: server.observations.snapshot(),
          rules,
          states,
          muted: (mutes.get(server.id) ?? 0) > now,
        });
        await writeEvaluation(this.db, { writes: evaluation.writes, events: evaluation.events, nowMs: now });
        evaluation.commit();
        for (const event of evaluation.events) {
          // The alert log's own line: ids and counts only, never a name or a secret.
          this.options.logger.info({ serverId: server.id, alert: event.kind, subject: event.subject, transition: event.transition }, "alert event recorded");
        }
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
      }
    }

    if (this.lastPurgeAt === undefined || now - this.lastPurgeAt >= this.purgeIntervalMs) {
      const purged = await purgeExpiredEvents(this.db, now);
      this.lastPurgeAt = now;
      if (purged > 0) this.options.logger.info({ purged }, "expired alert events purged");
    }
    if (failed) throw firstError;
  }
}
