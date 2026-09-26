import type {
  AlertDestinationsResponse,
  AlertEventsResponse,
  AlertRuleResponse,
  AlertRulesResponse,
  AlertStatusResponse,
  CreateAlertRuleRequest,
  UpdateAlertRuleRequest,
} from "../src/index";

/** ADR-0027 PR 7a: invented values for the alerts contract. Ids are made up; nothing here is a real webhook. */

const PRESET_OUTAGE = "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e01";
const PRESET_STOPPED = "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e02";
const PRESET_UNREACHABLE = "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e03";
const RULE_PRODUCTION = "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e04";
const DELETED_RULE = "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e99";

const created = "2026-09-20T10:00:00.000Z";

/** The three seeded presets and one opt-in production rule, which is disabled. */
export const alertRulesList = {
  rules: [
    { id: PRESET_OUTAGE, kind: "power_outage", params: {}, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical", enabled: true, preset: true, createdAt: created, updatedAt: created },
    {
      id: PRESET_STOPPED,
      kind: "stopped_machines",
      params: { stoppedBelowPercent: 5 },
      forSeconds: 300,
      clearSeconds: 120,
      repeatSeconds: 3600,
      severity: "warning",
      enabled: true,
      preset: true,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: PRESET_UNREACHABLE,
      kind: "server_unreachable",
      params: { failedPolls: 3, minSeconds: 120 },
      forSeconds: 0,
      clearSeconds: 60,
      repeatSeconds: 3600,
      severity: "critical",
      enabled: true,
      preset: true,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: RULE_PRODUCTION,
      kind: "production_below_target",
      params: { item: "Desc_IronPlate_C", targetPerMinute: 120, windowMinutes: 10 },
      forSeconds: 600,
      clearSeconds: 300,
      repeatSeconds: 3600,
      severity: "warning",
      enabled: false,
      preset: false,
      createdAt: "2026-09-26T09:30:00.000Z",
      updatedAt: "2026-09-26T11:45:00.000Z",
    },
  ],
} satisfies AlertRulesResponse;

/** No rules at all (a server whose presets have not been seeded yet). */
export const alertRulesEmpty = { rules: [] } satisfies AlertRulesResponse;

/** POST /alerts/rules: everything spelled out (the schema fills these defaults in when they are left out). */
export const alertCreateRuleRequest = {
  kind: "production_below_target",
  params: { item: "Desc_CopperIngot_C", targetPerMinute: 60, windowMinutes: 10 },
  severity: "warning",
  enabled: true,
  forSeconds: 600,
  clearSeconds: 300,
  repeatSeconds: 3600,
} satisfies CreateAlertRuleRequest;

/** POST answers 201 with the created rule. */
export const alertRuleCreated = {
  rule: {
    id: "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e05",
    kind: "production_below_target",
    params: { item: "Desc_CopperIngot_C", targetPerMinute: 60, windowMinutes: 10 },
    forSeconds: 600,
    clearSeconds: 300,
    repeatSeconds: 3600,
    severity: "warning",
    enabled: true,
    preset: false,
    createdAt: "2026-09-26T12:00:00.000Z",
    updatedAt: "2026-09-26T12:00:00.000Z",
  },
} satisfies AlertRuleResponse;

/** PATCH: only the fields to change (here the target and the severity; `item` may never be sent). */
export const alertUpdateRuleRequest = {
  severity: "critical",
  params: { targetPerMinute: 90 },
} satisfies UpdateAlertRuleRequest;

/** A preset that was disabled through PATCH `{ enabled: false }`. */
export const alertRuleUpdatedPresetDisabled = {
  rule: { ...alertRulesList.rules[0], enabled: false, updatedAt: "2026-09-26T12:05:00.000Z" },
} satisfies AlertRuleResponse;

export const alertDeleteRuleResponse = { deleted: true } as const;

/** The webhook is configured and working. Only the last 4 characters are ever shown. */
export const alertDestinationsConfigured = {
  discord: { last4: "aB3d", enabled: true, disabledReason: null, updatedAt: "2026-09-25T18:00:00.000Z" },
} satisfies AlertDestinationsResponse;

/** Nothing is configured yet. */
export const alertDestinationsNone = { discord: null } satisfies AlertDestinationsResponse;

/** Discord answered 404/401 twice: the webhook is gone and the destination disabled itself. */
export const alertDestinationsWebhookGone = {
  discord: { last4: "aB3d", enabled: false, disabledReason: "webhook_gone", updatedAt: "2026-09-26T08:15:00.000Z" },
} satisfies AlertDestinationsResponse;

/** PUT /alerts/destinations/discord: the URL exists ONLY in this request. */
export const alertPutDiscordRequest = {
  webhookUrl: "https://discord.com/api/webhooks/123456789012345678/EXAMPLE_TOKEN_NOT_REAL_aB3d",
};

/** PATCH /alerts/destinations/discord `{ enabled: false }` (the reason becomes "manual"). */
export const alertPatchDiscordRequest = { enabled: false };

export const alertPatchDiscordResponseDisabledManually = {
  discord: { last4: "aB3d", enabled: false, disabledReason: "manual", updatedAt: "2026-09-26T12:10:00.000Z" },
};

export const alertDeleteDestinationResponse = { deleted: true } as const;

/** POST .../test: the message was accepted, or one stable code says why not. */
export const alertSendTestOk = { ok: true } as const;
export const alertSendTestWebhookGone = { ok: false, code: "webhook_gone" } as const;
export const alertSendTestRateLimited = { ok: false, code: "rate_limited" } as const;

/** A first page: all four transitions, both stopped-machine reasons, a production event; more pages follow. */
export const alertEventsPage = {
  events: [
    {
      id: "412",
      at: "2026-09-26T11:50:00.000Z",
      ruleId: RULE_PRODUCTION,
      kind: "production_below_target",
      severity: "warning",
      subject: "item",
      transition: "resolved",
      summary: { item: "Desc_IronPlate_C", targetPerMinute: 120, averagePerMinute: 118.4, windowMinutes: 10 },
    },
    {
      id: "411",
      at: "2026-09-26T11:20:00.000Z",
      ruleId: RULE_PRODUCTION,
      kind: "production_below_target",
      severity: "warning",
      subject: "item",
      transition: "fired",
      summary: { item: "Desc_IronPlate_C", targetPerMinute: 120, averagePerMinute: 84.2, windowMinutes: 10 },
    },
    {
      id: "410",
      at: "2026-09-26T10:40:00.000Z",
      ruleId: PRESET_STOPPED,
      kind: "stopped_machines",
      severity: "warning",
      subject: "group",
      transition: "updated",
      summary: {
        machines: 6,
        byRecipe: [{ recipe: "Iron Plate", count: 4 }, { recipe: null, count: 2 }],
        byReason: [{ reason: "output full", count: 4 }, { reason: "input short: Desc_IronIngot_C", count: 2 }],
        newMachines: 2,
      },
    },
    {
      id: "409",
      at: "2026-09-26T10:00:00.000Z",
      ruleId: PRESET_STOPPED,
      kind: "stopped_machines",
      severity: "warning",
      subject: "group",
      transition: "renotify",
      summary: {
        machines: 4,
        byRecipe: [{ recipe: "Iron Plate", count: 4 }],
        byReason: [{ reason: "output full", count: 4 }],
      },
    },
    {
      id: "408",
      at: "2026-09-26T09:00:00.000Z",
      ruleId: PRESET_STOPPED,
      kind: "stopped_machines",
      severity: "warning",
      subject: "group",
      transition: "fired",
      summary: {
        machines: 4,
        byRecipe: [{ recipe: "Iron Plate", count: 4 }],
        byReason: [{ reason: "output full", count: 4 }],
      },
    },
  ],
  nextBefore: "408",
} satisfies AlertEventsResponse;

/** The last page: a power outage (a rule deleted since, so `ruleId` is null) and the end of the log. */
export const alertEventsLastPage = {
  events: [
    {
      id: "407",
      at: "2026-09-25T20:10:00.000Z",
      ruleId: DELETED_RULE,
      kind: "power_outage",
      severity: "critical",
      subject: "circuit:3",
      transition: "fired",
      summary: { circuit: 3 },
    },
    {
      id: "406",
      at: "2026-09-25T19:00:00.000Z",
      ruleId: null,
      kind: "server_unreachable",
      severity: "critical",
      subject: "server",
      transition: "resolved",
      summary: { failedPolls: 12, downForSeconds: 360 },
    },
  ],
  nextBefore: null,
} satisfies AlertEventsResponse;

/** An empty log. */
export const alertEventsEmpty = { events: [], nextBefore: null } satisfies AlertEventsResponse;

/** Delivery is off (the shadow week), alerts are muted, and one alert is firing. */
export const alertStatusShadowMutedFiring = {
  deliveryEnabled: false,
  mutedUntil: "2026-09-26T18:00:00.000Z",
  firing: [{ ruleId: PRESET_STOPPED, kind: "stopped_machines", subject: "group", severity: "warning", since: "2026-09-26T09:00:00.000Z" }],
} satisfies AlertStatusResponse;

/** Delivery on, not muted, nothing firing. */
export const alertStatusQuiet = { deliveryEnabled: true, mutedUntil: null, firing: [] } satisfies AlertStatusResponse;

/** PUT /alerts/mute: a time in the future, at most 7 days ahead. */
export const alertSetMuteRequest = { until: "2026-09-26T18:00:00.000Z" };
export const alertMuteSetResponse = { mutedUntil: "2026-09-26T18:00:00.000Z" };
/** DELETE /alerts/mute */
export const alertMuteClearedResponse = { mutedUntil: null };
