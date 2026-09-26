import { z } from "zod";

/**
 * ADR-0027 PR 7a: the alerts contract (rules, the Discord destination, the alert log, status and mute). All routes are
 * under `/api/servers/:serverId/alerts/...`. Every GET is for any member of the server; every other method (including
 * `POST .../test`) is owner/admin only (the existing `authorizeServer` rule).
 *
 * DEPLOY SKEW: RESPONSE fields that name kinds, transitions, severities or reasons are `z.string()` with the known
 * values in `.describe()`, so a newer backend (for example ADR-0031's `agent_offline` kind) never breaks an older
 * frontend's parse. REQUESTS are strict: `z.strictObject` and enums.
 */

/** The rule kinds the engine knows today. Responses carry `kind` as a plain string; this list is for the UI. */
export const KNOWN_RULE_KINDS = ["power_outage", "fuse_trip", "stopped_machines", "server_unreachable", "production_below_target"] as const;
/** The only kind a rule can be CREATED with through the API (the others are seeded presets, or not offered). */
export const CREATABLE_RULE_KINDS = ["production_below_target"] as const;
export const KNOWN_SEVERITIES = ["info", "warning", "critical"] as const;
export const KNOWN_EVENT_TRANSITIONS = ["fired", "updated", "renotify", "resolved"] as const;

// An ISO 8601 time. zod's default accepts only a trailing `Z`; `offset: true` also takes `+02:00`, so a Postgres-formatted
// response time or a mute time typed with the user's offset is not refused for its notation.
const IsoTimeSchema = z.iso.datetime({ offset: true });

export const RuleIdSchema = z.uuid().describe("A rule's id");
export const SeveritySchema = z.enum(KNOWN_SEVERITIES);

// The DB CHECKs: `for` and `clear` 0 to 86400 s, repeat 60 s to 7 days.
const ForSecondsSchema = z.number().int().min(0).max(86_400);
const ClearSecondsSchema = z.number().int().min(0).max(86_400);
const RepeatSecondsSchema = z.number().int().min(60).max(604_800);

// ---------------------------------------------------------------------------------------------------------------------
// Per-kind parameters (typed, for the UI to parse `AlertRule.params` when `kind` matches)
// ---------------------------------------------------------------------------------------------------------------------

/** `power_outage` and `fuse_trip` have no parameters. */
export const NoRuleParamsSchema = z.strictObject({});

/** `stopped_machines` (a preset). A machine counts as stopped below this best output percent. */
export const StoppedMachinesParamsSchema = z.strictObject({
  stoppedBelowPercent: z.number().min(0).max(100).default(5),
});

/** `server_unreachable` (a preset). */
export const ServerUnreachableParamsSchema = z.strictObject({
  failedPolls: z.number().int().min(1).max(1000).default(3).describe("Status polls that must fail in a row..."),
  minSeconds: z.number().int().min(0).max(86_400).default(120).describe("...for at least this long"),
});

/** `production_below_target` (ADR-0027 amendment 3): opt-in per item, no preset. */
export const ProductionBelowTargetParamsSchema = z.strictObject({
  item: z.string().min(1).max(200).describe("The item's class name (for example Desc_IronPlate_C). Immutable once created."),
  targetPerMinute: z.number().positive().finite().describe("The wanted factory-wide production, items per minute"),
  windowMinutes: z.number().min(5).max(60).default(10).describe("The rolling window the average is taken over, minutes"),
});

/** What a PATCH may change for `production_below_target`: the target and/or the window, never the item. */
export const ProductionBelowTargetUpdateParamsSchema = z
  .strictObject({
    targetPerMinute: ProductionBelowTargetParamsSchema.shape.targetPerMinute.optional(),
    windowMinutes: ProductionBelowTargetParamsSchema.shape.windowMinutes.unwrap().optional(),
  })
  .refine((params) => params.targetPerMinute !== undefined || params.windowMinutes !== undefined, "Send the target and/or the window");

// ---------------------------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------------------------

export const AlertRuleSchema = z.object({
  id: RuleIdSchema,
  kind: z.string().describe("Known: power_outage, fuse_trip, stopped_machines, server_unreachable, production_below_target. Handle others generically."),
  params: z.record(z.string(), z.unknown()).describe("Parse with the per-kind params schema when `kind` is known"),
  forSeconds: ForSecondsSchema.describe("The condition must hold this long before the alert fires (0 = at once)"),
  clearSeconds: ClearSecondsSchema.describe("...and be false this long before a firing alert resolves"),
  repeatSeconds: RepeatSecondsSchema.describe("The shortest time between two notifications for one firing alert"),
  severity: z.string().describe("Known: info, warning, critical"),
  enabled: z.boolean(),
  preset: z.boolean().describe("Seeded by the app. A preset can be disabled and tuned but never deleted (preset_disable_only)"),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
});

/** GET /alerts/rules */
export const AlertRulesResponseSchema = z.object({ rules: z.array(AlertRuleSchema) });
/** POST (201) and PATCH answer with the rule. */
export const AlertRuleResponseSchema = z.object({ rule: AlertRuleSchema });

/**
 * POST /alerts/rules. A discriminated union on `kind`; today only `production_below_target` can be created
 * (another kind answers rule_kind_not_creatable). Defaults: severity warning, enabled, for 600 s, clear 300 s, repeat 3600 s.
 */
export const CreateAlertRuleRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("production_below_target"),
    params: ProductionBelowTargetParamsSchema,
    severity: SeveritySchema.default("warning"),
    enabled: z.boolean().default(true),
    forSeconds: ForSecondsSchema.default(600),
    clearSeconds: ClearSecondsSchema.default(300),
    repeatSeconds: RepeatSecondsSchema.default(3600),
  }),
]);

/**
 * PATCH /alerts/rules/:ruleId: only the fields to change, at least one. `params` is a plain record here so the backend
 * can answer a rule that includes `item` with rule_item_immutable (not a generic bad_request); the UI builds it from
 * `ProductionBelowTargetUpdateParamsSchema`.
 */
export const UpdateAlertRuleRequestSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    severity: SeveritySchema.optional(),
    forSeconds: ForSecondsSchema.optional(),
    clearSeconds: ClearSecondsSchema.optional(),
    repeatSeconds: RepeatSecondsSchema.optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), "Send at least one field to change");

/** DELETE /alerts/rules/:ruleId (a preset answers 409 preset_disable_only) */
export const DeleteAlertRuleResponseSchema = z.object({ deleted: z.literal(true) });

// ---------------------------------------------------------------------------------------------------------------------
// Destinations (Discord)
// ---------------------------------------------------------------------------------------------------------------------

/** A configured Discord webhook. The URL is a secret: it is NEVER in a response, only its last 4 characters. */
export const DiscordDestinationSchema = z.object({
  last4: z.string().length(4).describe("The last 4 characters of the webhook URL"),
  enabled: z.boolean(),
  disabledReason: z.string().nullable().describe("null while enabled. Known: webhook_gone, invalid_url, manual"),
  updatedAt: IsoTimeSchema,
});

/** GET /alerts/destinations: `discord` is null when none is configured. */
export const AlertDestinationsResponseSchema = z.object({ discord: DiscordDestinationSchema.nullable() });
/** PUT and PATCH /alerts/destinations/discord */
export const DiscordDestinationResponseSchema = z.object({ discord: DiscordDestinationSchema });

/**
 * PUT /alerts/destinations/discord. The URL exists ONLY in this request body: never in a response, a log or an error.
 * Saving replaces the webhook and re-enables the destination. A refused URL answers webhook_invalid with a `reason`.
 */
export const PutDiscordDestinationRequestSchema = z.strictObject({ webhookUrl: z.string().max(300) });
/** PATCH /alerts/destinations/discord: `false` sets disabledReason "manual". */
export const PatchDiscordDestinationRequestSchema = z.strictObject({ enabled: z.boolean() });
/** DELETE /alerts/destinations/discord */
export const DeleteDestinationResponseSchema = z.object({ deleted: z.literal(true) });

/**
 * POST /alerts/destinations/discord/test (no body): sends one test message. delivery_off (409) while the kill switch is
 * off, destination_not_configured (404) with none, rate_limited (429) when asked too often.
 */
export const SendTestResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), code: z.string().describe("Known: webhook_gone, rejected, rate_limited, timeout, network") }),
]);

// ---------------------------------------------------------------------------------------------------------------------
// The alert log
// ---------------------------------------------------------------------------------------------------------------------

export const AlertEventSchema = z.object({
  id: z.string().describe("A bigint identity as a string. Pass it as `before` to page backwards."),
  at: IsoTimeSchema,
  ruleId: RuleIdSchema.nullable().describe("null once the rule was deleted (the log outlives the rule)"),
  kind: z.string().describe("Copied from the rule when the event was written"),
  severity: z.string().describe("Known: info, warning, critical"),
  subject: z.string().describe("What it is about: circuit:<id>, group, server or item"),
  transition: z.string().describe("Known: fired, updated, renotify, resolved"),
  summary: z.record(z.string(), z.unknown()).describe("Game data only. Parse with the per-kind summary schema when `kind` is known"),
});

/** GET /alerts/events?limit=&before=: newest first. */
export const AlertEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().regex(/^\d{1,19}$/).optional().describe("An event id: only events older than it are returned"),
});
export const AlertEventsResponseSchema = z.object({
  events: z.array(AlertEventSchema),
  nextBefore: z.string().nullable().describe("Pass as `before` for the next page; null on the last page"),
});

// Typed summaries, for the UI to parse `AlertEvent.summary` when `kind` matches.
export const PowerOutageSummarySchema = z.object({ circuit: z.number().int().min(0) });
export const ServerUnreachableSummarySchema = z.object({
  failedPolls: z.number().int().min(0),
  downForSeconds: z.number().int().min(0),
});
export const StoppedMachinesSummarySchema = z.object({
  machines: z.number().int().min(0).describe("How many machines the message covers"),
  byRecipe: z.array(z.object({ recipe: z.string().nullable().describe("null = no recipe set"), count: z.number().int().min(0) })),
  byReason: z.array(
    z.object({
      reason: z.string().describe('"output full" or "input short" or "input short: <item class name>"'),
      count: z.number().int().min(0),
    }),
  ),
  newMachines: z.number().int().min(0).optional().describe("Only on an `updated` event: machines that joined a firing group"),
});
export const ProductionBelowTargetSummarySchema = z.object({
  item: z.string(),
  targetPerMinute: z.number(),
  averagePerMinute: z.number().optional().describe("The window average. Absent on a reminder sent while the window refills."),
  windowMinutes: z.number(),
});

// ---------------------------------------------------------------------------------------------------------------------
// Status and mute
// ---------------------------------------------------------------------------------------------------------------------

export const FiringAlertSchema = z.object({
  ruleId: RuleIdSchema,
  kind: z.string(),
  subject: z.string(),
  severity: z.string().describe("Known: info, warning, critical"),
  since: IsoTimeSchema,
});

/** GET /alerts/status. `deliveryEnabled` false = the kill switch is off ("Delivery is off (shadow week)"). */
export const AlertStatusResponseSchema = z.object({
  deliveryEnabled: z.boolean(),
  mutedUntil: IsoTimeSchema.nullable(),
  firing: z.array(FiringAlertSchema),
});

/**
 * PUT /alerts/mute. `until` must be in the future and at most 7 days ahead; the backend checks that against its own
 * clock (a bad value answers mute_invalid), so it is not in the schema.
 */
export const SetMuteRequestSchema = z.strictObject({ until: IsoTimeSchema });
export const MuteSetResponseSchema = z.object({ mutedUntil: IsoTimeSchema });
/** DELETE /alerts/mute */
export const MuteClearedResponseSchema = z.object({ mutedUntil: z.null() });

export type AlertRule = z.infer<typeof AlertRuleSchema>;
export type AlertRulesResponse = z.infer<typeof AlertRulesResponseSchema>;
export type AlertRuleResponse = z.infer<typeof AlertRuleResponseSchema>;
export type CreateAlertRuleRequest = z.input<typeof CreateAlertRuleRequestSchema>;
export type UpdateAlertRuleRequest = z.input<typeof UpdateAlertRuleRequestSchema>;
export type ProductionBelowTargetParams = z.infer<typeof ProductionBelowTargetParamsSchema>;
export type DiscordDestination = z.infer<typeof DiscordDestinationSchema>;
export type AlertDestinationsResponse = z.infer<typeof AlertDestinationsResponseSchema>;
export type AlertEvent = z.infer<typeof AlertEventSchema>;
export type AlertEventsResponse = z.infer<typeof AlertEventsResponseSchema>;
export type AlertStatusResponse = z.infer<typeof AlertStatusResponseSchema>;
