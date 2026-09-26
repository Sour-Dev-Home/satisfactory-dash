import { z } from "zod";
import {
  ProductionBelowTargetUpdateParamsSchema,
  RuleIdSchema,
  type AlertDestinationsResponseSchema,
  type AlertEventsResponseSchema,
  type AlertRuleResponseSchema,
  type AlertRulesResponseSchema,
  type AlertStatusResponseSchema,
  type CreateAlertRuleRequestSchema,
  type DeleteAlertRuleResponseSchema,
  type DeleteDestinationResponseSchema,
  type DiscordDestinationResponseSchema,
  type MuteClearedResponseSchema,
  type MuteSetResponseSchema,
  type SendTestResponseSchema,
  type UpdateAlertRuleRequestSchema,
} from "@satisfactory-dash/shared";
import { ApiFailure, BadRequestError, RateLimitedError, ServerNotFoundError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { isDatabaseUnavailable } from "../../../platform/db/errors.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import { recordAuditEvent } from "../../../platform/audit/auditRepository.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import type { AlertDeliveryMode } from "../config.js";
import {
  clearMute,
  countRules,
  deleteDestination,
  deleteRule,
  enableDestination,
  getApiRule,
  getMute,
  getServerUuid,
  insertRule,
  itemRuleExists,
  listApiRules,
  listEvents,
  listFiring,
  lockServer,
  setMute,
  updateRule,
  type ApiRuleRow,
} from "../repositories/apiRepository.js";
import { disableDestinationIn, getDestinationSummary, saveDiscordDestination } from "../repositories/deliveryRepository.js";
import { parseRuleParams } from "./rules.js";
import { sendAlertTest } from "./sendTest.js";

/**
 * ADR-0027 PR 7b: the alerts API's logic. The routes call this interface (so the generated authorization tests can
 * stub it) and only ever see the shared contract's shapes. Every method takes the server's PUBLIC id, which the
 * membership check has already passed, and scopes every query by it. Every write runs in ONE transaction with its audit
 * event (`platform/audit`): only ids and codes go in the audit detail, never the webhook URL or any part of it.
 */
export type AlertRulesBody = z.infer<typeof AlertRulesResponseSchema>;
export type AlertRuleBody = z.infer<typeof AlertRuleResponseSchema>;
export type CreateRuleRequest = z.output<typeof CreateAlertRuleRequestSchema>;
export type UpdateRuleRequest = z.output<typeof UpdateAlertRuleRequestSchema>;

export interface AlertsService {
  listRules(serverId: string): Promise<AlertRulesBody>;
  createRule(serverId: string, actorUserId: string, body: CreateRuleRequest): Promise<AlertRuleBody>;
  updateRule(serverId: string, actorUserId: string, ruleId: string, body: UpdateRuleRequest): Promise<AlertRuleBody>;
  deleteRule(serverId: string, actorUserId: string, ruleId: string): Promise<z.infer<typeof DeleteAlertRuleResponseSchema>>;
  getDestinations(serverId: string): Promise<z.infer<typeof AlertDestinationsResponseSchema>>;
  putDiscord(serverId: string, actorUserId: string, webhookUrl: string): Promise<z.infer<typeof DiscordDestinationResponseSchema>>;
  patchDiscord(serverId: string, actorUserId: string, enabled: boolean): Promise<z.infer<typeof DiscordDestinationResponseSchema>>;
  removeDiscord(serverId: string, actorUserId: string): Promise<z.infer<typeof DeleteDestinationResponseSchema>>;
  testDiscord(serverId: string, actorUserId: string): Promise<z.infer<typeof SendTestResponseSchema>>;
  listEvents(serverId: string, query: { limit: number; before?: string }): Promise<z.infer<typeof AlertEventsResponseSchema>>;
  getStatus(serverId: string): Promise<z.infer<typeof AlertStatusResponseSchema>>;
  setMute(serverId: string, actorUserId: string, untilIso: string): Promise<z.infer<typeof MuteSetResponseSchema>>;
  clearMute(serverId: string, actorUserId: string): Promise<z.infer<typeof MuteClearedResponseSchema>>;
}

/** The most rules one server can have (presets included): a stray script cannot fill the table or the evaluator's tick. */
export const MAX_RULES_PER_SERVER = 50;
/** A mute is at most this far ahead. */
export const MAX_MUTE_MS = 7 * 24 * 60 * 60 * 1000;

export const toApiRule = (row: ApiRuleRow): AlertRuleBody["rule"] => ({
  id: row.id,
  kind: row.kind,
  params: row.params,
  forSeconds: row.forSeconds,
  clearSeconds: row.clearSeconds,
  repeatSeconds: row.repeatSeconds,
  severity: row.severity,
  enabled: row.enabled,
  preset: row.preset,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

// What a PATCH may change in `params`, by kind. `item` is never among them (rule_item_immutable, answered before this).
const StoppedMachinesUpdate = z.strictObject({ stoppedBelowPercent: z.number().min(0).max(100) });
const ServerUnreachableUpdate = z
  .strictObject({ failedPolls: z.number().int().min(1).max(1000).optional(), minSeconds: z.number().int().min(0).max(86_400).optional() })
  .refine((params) => params.failedPolls !== undefined || params.minSeconds !== undefined, "Send failedPolls and/or minSeconds");

function updateSchemaFor(kind: string): z.ZodType<Record<string, unknown>> | undefined {
  switch (kind) {
    case "production_below_target":
      return ProductionBelowTargetUpdateParamsSchema;
    case "stopped_machines":
      return StoppedMachinesUpdate;
    case "server_unreachable":
      return ServerUnreachableUpdate;
    default:
      return undefined; // power_outage and fuse_trip have no parameters
  }
}

export type PatchPlan = { ok: true; next: Omit<ApiRuleRow, "id" | "kind" | "preset" | "createdAt" | "updatedAt">; changed: string[] } | { ok: false; failure: ApiFailure | BadRequestError };

/**
 * Merges a PATCH into a rule's current values. Pure (no I/O), so it is tested without a database. `item` in the params
 * is rule_item_immutable whatever else is sent; the rest is validated strictly with the per-kind update schema and then
 * again, merged, with the engine's own params schema, so what is stored is always something the engine can read.
 */
export function planPatch(current: ApiRuleRow, body: UpdateRuleRequest): PatchPlan {
  let params = current.params;
  const changed: string[] = [];
  if (body.params !== undefined) {
    if (Object.hasOwn(body.params, "item")) {
      return { ok: false, failure: new ApiFailure("rule_item_immutable", "A rule's item cannot be changed. Create a new rule for another item.") };
    }
    const schema = updateSchemaFor(current.kind);
    if (schema === undefined) return { ok: false, failure: new BadRequestError("That rule has no parameters to change") };
    const update = schema.safeParse(body.params);
    if (!update.success) return { ok: false, failure: new BadRequestError("Invalid rule parameters") };
    const merged = parseRuleParams(current.kind, { ...current.params, ...update.data });
    if (merged === undefined) return { ok: false, failure: new BadRequestError("Invalid rule parameters") };
    params = merged.params as Record<string, unknown>;
    changed.push("params");
  }
  const next = {
    params,
    enabled: body.enabled ?? current.enabled,
    severity: body.severity ?? current.severity,
    forSeconds: body.forSeconds ?? current.forSeconds,
    clearSeconds: body.clearSeconds ?? current.clearSeconds,
    repeatSeconds: body.repeatSeconds ?? current.repeatSeconds,
  };
  for (const field of ["enabled", "severity", "forSeconds", "clearSeconds", "repeatSeconds"] as const) {
    if (body[field] !== undefined) changed.push(field);
  }
  return { ok: true, next, changed };
}

/** A mute time must be in the future and at most 7 days ahead. Returns the Date, or undefined. */
export function validateMuteUntil(untilIso: string, nowMs: number): Date | undefined {
  const until = new Date(untilIso);
  const ms = until.getTime();
  return Number.isFinite(ms) && ms > nowMs && ms <= nowMs + MAX_MUTE_MS ? until : undefined;
}

export interface AlertsServiceDeps {
  /** The pool: writes use a transaction so each change and its audit event are one unit. */
  db: Queryable & Parameters<typeof withTransaction>[0];
  /** The secrets keyring (webhooks are stored encrypted); null when SERVER_SECRETS_KEY is not set. */
  ring: SecretsKeyring | null;
  mode: AlertDeliveryMode;
  /** A server's display name (for the test message), or undefined. */
  serverName: (serverId: string) => string | undefined;
  /** Per user, for "send test": each one is a real request to Discord. Default: 5 per minute. */
  testLimiter?: UserRateLimiter;
  now?: () => number;
  fetch?: typeof fetch;
}

/** A database outage is a 503, never a 500 or a "not found". */
async function orUnavailable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isDatabaseUnavailable(err)) throw Object.assign(new ServiceUnavailableError(), { cause: err });
    throw err;
  }
}

const destinationNotConfigured = (): ApiFailure => new ApiFailure("destination_not_configured", "No Discord webhook is set up for this server");
const ruleNotFound = (): ApiFailure => new ApiFailure("rule_not_found", "That alert rule was not found on this server");

export function createAlertsService(deps: AlertsServiceDeps): AlertsService {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const testLimiter = deps.testLimiter ?? new UserRateLimiter({ max: 5, windowMs: 60_000 });

  /** Runs `work` in a transaction on this server (its row is locked while it runs), so the change and its audit event commit together. */
  const inServerTransaction = <T>(serverId: string, work: (client: Queryable, serverUuid: string) => Promise<T>): Promise<T> =>
    orUnavailable(() =>
      withTransaction(db, async (client) => {
        const serverUuid = await lockServer(client, serverId);
        if (serverUuid === undefined) throw new ServerNotFoundError();
        return work(client, serverUuid);
      }),
    );

  const audit = (client: Queryable, actorUserId: string, serverUuid: string, action: string, detail: Record<string, unknown>) =>
    recordAuditEvent(client, { action, actorUserId, serverId: serverUuid, detail });

  const summaryBody = async (client: Queryable, serverId: string) => {
    const summary = await getDestinationSummary(client, serverId);
    if (summary === undefined) throw destinationNotConfigured();
    return { discord: { last4: summary.last4, enabled: summary.enabled, disabledReason: summary.disabledReason, updatedAt: summary.updatedAt.toISOString() } };
  };

  return {
    listRules: (serverId) => orUnavailable(async () => ({ rules: (await listApiRules(db, serverId)).map(toApiRule) })),

    createRule: (serverId, actorUserId, body) =>
      inServerTransaction(serverId, async (client, serverUuid) => {
        const params = parseRuleParams("production_below_target", body.params);
        if (params === undefined || params.kind !== "production_below_target") throw new BadRequestError("Invalid rule parameters");
        if ((await countRules(client, serverId)) >= MAX_RULES_PER_SERVER) {
          throw new BadRequestError(`A server can have at most ${MAX_RULES_PER_SERVER} alert rules`);
        }
        if (await itemRuleExists(client, serverId, params.params.item)) {
          throw new BadRequestError("There is already a rule for that item on this server");
        }
        const id = await insertRule(client, serverUuid, {
          kind: body.kind,
          params: params.params,
          forSeconds: body.forSeconds,
          clearSeconds: body.clearSeconds,
          repeatSeconds: body.repeatSeconds,
          severity: body.severity,
          enabled: body.enabled,
        });
        const created = await getApiRule(client, serverId, id);
        if (created === undefined) throw new Error("the rule just created could not be read back");
        await audit(client, actorUserId, serverUuid, "alerts.rule.created", { ruleId: id, kind: body.kind, item: params.params.item });
        return { rule: toApiRule(created) };
      }),

    updateRule: (serverId, actorUserId, ruleId, body) =>
      inServerTransaction(serverId, async (client, serverUuid) => {
        if (!RuleIdSchema.safeParse(ruleId).success) throw ruleNotFound();
        const current = await getApiRule(client, serverId, ruleId, { forUpdate: true });
        if (current === undefined) throw ruleNotFound();
        const plan = planPatch(current, body);
        if (!plan.ok) throw plan.failure;
        await updateRule(client, serverId, ruleId, plan.next);
        const updated = await getApiRule(client, serverId, ruleId);
        if (updated === undefined) throw ruleNotFound();
        await audit(client, actorUserId, serverUuid, "alerts.rule.updated", { ruleId, kind: current.kind, changed: plan.changed });
        return { rule: toApiRule(updated) };
      }),

    deleteRule: (serverId, actorUserId, ruleId) =>
      inServerTransaction(serverId, async (client, serverUuid) => {
        if (!RuleIdSchema.safeParse(ruleId).success) throw ruleNotFound();
        const current = await getApiRule(client, serverId, ruleId, { forUpdate: true });
        if (current === undefined) throw ruleNotFound();
        if (current.preset) throw new ApiFailure("preset_disable_only", "A preset rule can be disabled but not deleted");
        if (!(await deleteRule(client, serverId, ruleId))) throw ruleNotFound();
        await audit(client, actorUserId, serverUuid, "alerts.rule.deleted", { ruleId, kind: current.kind });
        return { deleted: true as const };
      }),

    getDestinations: (serverId) =>
      orUnavailable(async () => {
        const summary = await getDestinationSummary(db, serverId);
        return {
          discord:
            summary === undefined
              ? null
              : { last4: summary.last4, enabled: summary.enabled, disabledReason: summary.disabledReason, updatedAt: summary.updatedAt.toISOString() },
        };
      }),

    putDiscord: (serverId, actorUserId, webhookUrl) => {
      const ring = deps.ring;
      if (ring === null) return Promise.reject(new ServiceUnavailableError());
      return inServerTransaction(serverId, async (client, serverUuid) => {
        // The URL is a secret: nothing below may put it in an error, a log line or the audit detail. The parser and the
        // sealing return codes, and any other failure is replaced by a fixed message (with no cause).
        let saved: Awaited<ReturnType<typeof saveDiscordDestination>>;
        try {
          saved = await saveDiscordDestination(client, ring, serverId, webhookUrl);
        } catch (err) {
          if (isDatabaseUnavailable(err)) throw err;
          throw new Error("could not save the Discord webhook");
        }
        if (!saved.ok) {
          if (saved.code === "server_not_found") throw new ServerNotFoundError();
          throw new ApiFailure("webhook_invalid", "That is not a valid Discord webhook URL", saved.code);
        }
        await audit(client, actorUserId, serverUuid, "alerts.destination.set", { kind: "discord" });
        return summaryBody(client, serverId);
      });
    },

    patchDiscord: (serverId, actorUserId, enabled) =>
      inServerTransaction(serverId, async (client, serverUuid) => {
        const summary = await getDestinationSummary(client, serverId);
        if (summary === undefined) throw destinationNotConfigured();
        if (enabled) {
          if (!(await enableDestination(client, serverId))) throw destinationNotConfigured();
        } else {
          await disableDestinationIn(client, summary.id, "manual");
        }
        await audit(client, actorUserId, serverUuid, "alerts.destination.updated", { kind: "discord", enabled });
        return summaryBody(client, serverId);
      }),

    removeDiscord: (serverId, actorUserId) =>
      inServerTransaction(serverId, async (client, serverUuid) => {
        if (!(await deleteDestination(client, serverId))) throw destinationNotConfigured();
        await audit(client, actorUserId, serverUuid, "alerts.destination.removed", { kind: "discord" });
        return { deleted: true as const };
      }),

    testDiscord: async (serverId, actorUserId) => {
      // Each test is a real request to Discord: rate-limited per user, before anything else.
      const wait = testLimiter.hit(actorUserId);
      if (wait > 0) throw new RateLimitedError(wait, "Too many test messages. Try again shortly.");
      if (deps.mode !== "on") throw new ApiFailure("delivery_off", "Alert delivery is switched off, so no message was sent");
      const ring = deps.ring;
      if (ring === null) throw new ServiceUnavailableError();
      const { code } = await orUnavailable(() =>
        sendAlertTest({ mode: deps.mode, db, ring, serverPublicId: serverId, serverName: deps.serverName(serverId) ?? serverId, fetch: deps.fetch }),
      );
      const serverUuid = await orUnavailable(() => getServerUuid(db, serverId));
      if (serverUuid === undefined) throw new ServerNotFoundError();
      await orUnavailable(() => audit(db, actorUserId, serverUuid, "alerts.destination.tested", { kind: "discord", code }));
      switch (code) {
        case "sent":
          return { ok: true as const };
        case "delivery_off":
          throw new ApiFailure("delivery_off", "Alert delivery is switched off, so no message was sent");
        case "no_destination":
          throw destinationNotConfigured();
        default:
          return { ok: false as const, code };
      }
    },

    listEvents: (serverId, query) =>
      orUnavailable(async () => {
        const page = await listEvents(db, serverId, query);
        return {
          events: page.events.map((event) => ({ ...event, at: event.at.toISOString() })),
          nextBefore: page.hasMore && page.events.length > 0 ? page.events[page.events.length - 1]!.id : null,
        };
      }),

    getStatus: (serverId) =>
      orUnavailable(async () => {
        const [muted, firing] = await Promise.all([getMute(db, serverId), listFiring(db, serverId)]);
        return {
          deliveryEnabled: deps.mode === "on",
          mutedUntil: muted === undefined ? null : muted.toISOString(),
          firing: firing.map((row) => ({ ...row, since: row.since.toISOString() })),
        };
      }),

    setMute: (serverId, actorUserId, untilIso) => {
      const until = validateMuteUntil(untilIso, now());
      if (until === undefined) return Promise.reject(new ApiFailure("mute_invalid", "Choose a time in the future, at most 7 days ahead"));
      return inServerTransaction(serverId, async (client, serverUuid) => {
        const saved = await setMute(client, serverId, until);
        if (saved === undefined) throw new ServerNotFoundError();
        await audit(client, actorUserId, serverUuid, "alerts.muted", { until: saved.toISOString() });
        return { mutedUntil: saved.toISOString() };
      });
    },

    clearMute: (serverId, actorUserId) =>
      inServerTransaction(serverId, async (client, serverUuid) => {
        await clearMute(client, serverId);
        await audit(client, actorUserId, serverUuid, "alerts.unmuted", {});
        return { mutedUntil: null };
      }),
  };
}
