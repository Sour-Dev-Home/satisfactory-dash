import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  AlertEventSchema,
  AlertEventsQuerySchema,
  AlertRuleSchema,
  AlertStatusResponseSchema,
  ApiErrorResponseSchema,
  CREATABLE_RULE_KINDS,
  CreateAlertRuleRequestSchema,
  DiscordDestinationSchema,
  KNOWN_RULE_KINDS,
  KnownErrorCode,
  PatchDiscordDestinationRequestSchema,
  ProductionBelowTargetParamsSchema,
  ProductionBelowTargetSummarySchema,
  ProductionBelowTargetUpdateParamsSchema,
  PutDiscordDestinationRequestSchema,
  SendTestResponseSchema,
  ServerUnreachableParamsSchema,
  SetMuteRequestSchema,
  StoppedMachinesParamsSchema,
  StoppedMachinesSummarySchema,
  UpdateAlertRuleRequestSchema,
  endpoints,
} from "../src/index";

const production = { item: "Desc_IronPlate_C", targetPerMinute: 100 };

describe("alerts contract: rule creation (a strict request)", () => {
  it("fills the documented defaults: warning, enabled, for 600 s, clear 300 s, repeat 3600 s, a 10-minute window", () => {
    const parsed = CreateAlertRuleRequestSchema.parse({ kind: "production_below_target", params: production });
    expect(parsed).toEqual({
      kind: "production_below_target",
      params: { ...production, windowMinutes: 10 },
      severity: "warning",
      enabled: true,
      forSeconds: 600,
      clearSeconds: 300,
      repeatSeconds: 3600,
    });
  });

  it("only production_below_target can be created; every other kind is refused at the schema", () => {
    expect(CREATABLE_RULE_KINDS).toEqual(["production_below_target"]);
    for (const kind of KNOWN_RULE_KINDS.filter((k) => k !== "production_below_target")) {
      expect(CreateAlertRuleRequestSchema.safeParse({ kind, params: {} }).success, kind).toBe(false);
    }
    expect(CreateAlertRuleRequestSchema.safeParse({ kind: "agent_offline", params: {} }).success).toBe(false);
  });

  it("needs an item and a target above zero, and refuses unknown fields (a typo never becomes a default)", () => {
    const bad = [
      { kind: "production_below_target", params: { targetPerMinute: 5 } },
      { kind: "production_below_target", params: { item: "Desc_X_C" } },
      { kind: "production_below_target", params: { ...production, targetPerMinute: 0 } },
      { kind: "production_below_target", params: { ...production, targetPerMinute: -1 } },
      { kind: "production_below_target", params: { ...production, targetPerMinute: Number.POSITIVE_INFINITY } },
      { kind: "production_below_target", params: { ...production, item: "" } },
      { kind: "production_below_target", params: { ...production, windowMinute: 10 } },
      { kind: "production_below_target", params: production, preset: true },
      { kind: "production_below_target", params: production, severity: "fatal" },
    ];
    for (const body of bad) expect(CreateAlertRuleRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
  });

  it("bounds match the database: for/clear 0 to 86400 s, repeat 60 s to 7 days, window 5 to 60 minutes", () => {
    const ok = (over: Record<string, unknown>) => CreateAlertRuleRequestSchema.safeParse({ kind: "production_below_target", params: production, ...over }).success;
    expect([ok({ forSeconds: 0 }), ok({ forSeconds: 86_400 }), ok({ forSeconds: 86_401 }), ok({ forSeconds: -1 }), ok({ forSeconds: 1.5 })]).toEqual([true, true, false, false, false]);
    expect([ok({ clearSeconds: 0 }), ok({ clearSeconds: 86_400 }), ok({ clearSeconds: 86_401 })]).toEqual([true, true, false]);
    expect([ok({ repeatSeconds: 59 }), ok({ repeatSeconds: 60 }), ok({ repeatSeconds: 604_800 }), ok({ repeatSeconds: 604_801 })]).toEqual([false, true, true, false]);
    const window = (windowMinutes: unknown) => ProductionBelowTargetParamsSchema.safeParse({ ...production, windowMinutes }).success;
    expect([window(4.9), window(5), window(60), window(60.1), window("10")]).toEqual([false, true, true, false, false]);
  });
});

describe("alerts contract: rule update", () => {
  it("needs at least one field, and refuses unknown ones", () => {
    expect(UpdateAlertRuleRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateAlertRuleRequestSchema.safeParse({ enabled: undefined }).success).toBe(false);
    expect(UpdateAlertRuleRequestSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(UpdateAlertRuleRequestSchema.safeParse({ enabled: false, kind: "power_outage" }).success).toBe(false);
    expect(UpdateAlertRuleRequestSchema.safeParse({ severity: "loud" }).success).toBe(false);
    expect(UpdateAlertRuleRequestSchema.safeParse({ repeatSeconds: 30 }).success).toBe(false);
  });

  it("lets `item` through the request schema, so the backend can answer rule_item_immutable instead of a generic 400", () => {
    expect(UpdateAlertRuleRequestSchema.safeParse({ params: { item: "Desc_Other_C" } }).success).toBe(true);
  });

  it("the UI's update-params schema takes the target and/or the window and never the item", () => {
    expect(ProductionBelowTargetUpdateParamsSchema.safeParse({ targetPerMinute: 50 }).success).toBe(true);
    expect(ProductionBelowTargetUpdateParamsSchema.safeParse({ windowMinutes: 20 }).success).toBe(true);
    expect(ProductionBelowTargetUpdateParamsSchema.safeParse({}).success).toBe(false);
    expect(ProductionBelowTargetUpdateParamsSchema.safeParse({ item: "Desc_X_C", targetPerMinute: 5 }).success).toBe(false);
    expect(ProductionBelowTargetUpdateParamsSchema.safeParse({ targetPerMinute: 0 }).success).toBe(false);
    expect(ProductionBelowTargetUpdateParamsSchema.safeParse({ windowMinutes: 61 }).success).toBe(false);
  });
});

describe("alerts contract: typed params of the known kinds", () => {
  it("parses what the seeded presets carry", () => {
    const [outage, stopped, unreachable, prod] = fixtures.alertRulesList.rules;
    expect(outage.params).toEqual({});
    expect(StoppedMachinesParamsSchema.parse(stopped.params)).toEqual({ stoppedBelowPercent: 5 });
    expect(ServerUnreachableParamsSchema.parse(unreachable.params)).toEqual({ failedPolls: 3, minSeconds: 120 });
    expect(ProductionBelowTargetParamsSchema.parse(prod.params)).toEqual(prod.params);
  });

  it("fills the preset defaults when a param is missing", () => {
    expect(StoppedMachinesParamsSchema.parse({})).toEqual({ stoppedBelowPercent: 5 });
    expect(ServerUnreachableParamsSchema.parse({})).toEqual({ failedPolls: 3, minSeconds: 120 });
  });
});

describe("alerts contract: deploy skew (a newer backend must not break an older frontend)", () => {
  it("responses accept a kind, severity, transition and reason this build does not know", () => {
    const rule = { ...fixtures.alertRulesList.rules[0], kind: "agent_offline", severity: "urgent" };
    expect(AlertRuleSchema.parse(rule)).toMatchObject({ kind: "agent_offline", severity: "urgent" });
    const event = { ...fixtures.alertEventsPage.events[0], kind: "agent_offline", severity: "urgent", transition: "escalated" };
    expect(AlertEventSchema.parse(event)).toMatchObject({ kind: "agent_offline", transition: "escalated" });
    const destination = { ...fixtures.alertDestinationsWebhookGone.discord, disabledReason: "quota_exceeded" };
    expect(DiscordDestinationSchema.parse(destination).disabledReason).toBe("quota_exceeded");
    expect(SendTestResponseSchema.parse({ ok: false, code: "tls_error" })).toEqual({ ok: false, code: "tls_error" });
    expect(AlertStatusResponseSchema.safeParse({ ...fixtures.alertStatusShadowMutedFiring, firing: [{ ...fixtures.alertStatusShadowMutedFiring.firing[0], kind: "agent_offline", severity: "urgent" }] }).success).toBe(true);
  });

  it("an unknown error code still parses (clients handle codes generically)", () => {
    expect(ApiErrorResponseSchema.safeParse({ error: { code: "brand_new_code", message: "m", requestId: "r" } }).success).toBe(true);
  });
});

describe("alerts contract: the Discord destination never carries the URL", () => {
  it("the URL exists only in the PUT request, capped at 300 characters", () => {
    expect(PutDiscordDestinationRequestSchema.safeParse({ webhookUrl: "x".repeat(300) }).success).toBe(true);
    expect(PutDiscordDestinationRequestSchema.safeParse({ webhookUrl: "x".repeat(301) }).success).toBe(false);
    expect(PutDiscordDestinationRequestSchema.safeParse({ webhookUrl: "https://discord.com/x", extra: 1 }).success).toBe(false);
    expect(PutDiscordDestinationRequestSchema.safeParse({}).success).toBe(false);
  });

  it("a destination response has only the last 4 characters: a 5th character or an extra field never survives the schema", () => {
    expect(DiscordDestinationSchema.safeParse({ ...fixtures.alertDestinationsConfigured.discord, last4: "abcde" }).success).toBe(false);
    const withSecret = DiscordDestinationSchema.parse({ ...fixtures.alertDestinationsConfigured.discord, webhookUrl: fixtures.alertPutDiscordRequest.webhookUrl });
    expect(JSON.stringify(withSecret)).not.toContain("discord.com");
    expect(JSON.stringify(withSecret)).not.toContain("EXAMPLE_TOKEN");
  });

  it("no response fixture contains the webhook URL or its token", () => {
    const responses = Object.entries(fixtures).filter(([name]) => !name.endsWith("Request"));
    for (const [name, fixture] of responses) {
      expect(JSON.stringify(fixture), name).not.toContain("EXAMPLE_TOKEN");
      expect(JSON.stringify(fixture), name).not.toContain("/api/webhooks/");
    }
  });

  it("PATCH takes only `enabled`", () => {
    expect(PatchDiscordDestinationRequestSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(PatchDiscordDestinationRequestSchema.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(PatchDiscordDestinationRequestSchema.safeParse({ enabled: true, webhookUrl: "https://discord.com/x" }).success).toBe(false);
    expect(PatchDiscordDestinationRequestSchema.safeParse({}).success).toBe(false);
  });

  it("the test result is ok, or not ok with a code", () => {
    expect(SendTestResponseSchema.safeParse({ ok: true }).success).toBe(true);
    expect(SendTestResponseSchema.safeParse({ ok: false }).success).toBe(false);
    expect(SendTestResponseSchema.safeParse({ ok: "yes" }).success).toBe(false);
  });
});

describe("alerts contract: the log", () => {
  it("event ids are strings, and the query bounds are 1 to 100 (default 50) and a numeric `before`", () => {
    expect(typeof fixtures.alertEventsPage.events[0]!.id).toBe("string");
    expect(AlertEventsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(AlertEventsQuerySchema.parse({ limit: "100", before: "412" })).toEqual({ limit: 100, before: "412" });
    for (const limit of ["0", "101", "1.5", "abc"]) expect(AlertEventsQuerySchema.safeParse({ limit }).success, limit).toBe(false);
    for (const before of ["", "abc", "-1", "1e3", "12345678901234567890"]) expect(AlertEventsQuerySchema.safeParse({ before }).success, before).toBe(false);
  });

  it("a page has its cursor, and the last page has none", () => {
    expect(fixtures.alertEventsPage.nextBefore).toBe(fixtures.alertEventsPage.events.at(-1)!.id);
    expect(fixtures.alertEventsLastPage.nextBefore).toBeNull();
  });

  it("the pages show all four transitions, an event whose rule was deleted, and both stopped-machine reasons", () => {
    const events = [...fixtures.alertEventsPage.events, ...fixtures.alertEventsLastPage.events];
    expect(new Set(events.map((e) => e.transition))).toEqual(new Set(["fired", "updated", "renotify", "resolved"]));
    expect(events.some((e) => e.ruleId === null)).toBe(true);
    const reasons = events.flatMap((e) => (e.kind === "stopped_machines" ? StoppedMachinesSummarySchema.parse(e.summary).byReason.map((r) => r.reason) : []));
    expect(reasons).toContain("output full");
    expect(reasons.some((r) => r.startsWith("input short"))).toBe(true);
  });

  it("the typed summaries parse the events they belong to", () => {
    const [resolved, fired] = fixtures.alertEventsPage.events;
    expect(ProductionBelowTargetSummarySchema.parse(resolved.summary).item).toBe("Desc_IronPlate_C");
    expect(ProductionBelowTargetSummarySchema.parse(fired.summary).averagePerMinute).toBe(84.2);
    // A reminder sent while the window refills carries no average.
    expect(ProductionBelowTargetSummarySchema.safeParse({ item: "Desc_X_C", targetPerMinute: 10, windowMinutes: 10 }).success).toBe(true);
    const updated = fixtures.alertEventsPage.events.find((e) => e.transition === "updated")!;
    expect(StoppedMachinesSummarySchema.parse(updated.summary).newMachines).toBe(2);
  });
});

describe("alerts contract: status and mute", () => {
  it("shows the shadow week from deliveryEnabled, and the mute and the firing alerts", () => {
    expect(fixtures.alertStatusShadowMutedFiring).toMatchObject({ deliveryEnabled: false });
    expect(fixtures.alertStatusShadowMutedFiring.mutedUntil).not.toBeNull();
    expect(fixtures.alertStatusShadowMutedFiring.firing).toHaveLength(1);
    expect(fixtures.alertStatusQuiet).toEqual({ deliveryEnabled: true, mutedUntil: null, firing: [] });
  });

  it("the mute request is one ISO time; whether it is in the future is the backend's call", () => {
    expect(SetMuteRequestSchema.safeParse({ until: "2026-09-26T18:00:00.000Z" }).success).toBe(true);
    expect(SetMuteRequestSchema.safeParse({ until: "tomorrow" }).success).toBe(false);
    expect(SetMuteRequestSchema.safeParse({ until: "2026-09-26T18:00:00.000Z", extra: 1 }).success).toBe(false);
    expect(SetMuteRequestSchema.safeParse({}).success).toBe(false);
  });

  it("times are ISO 8601 with a Z or an offset, with or without milliseconds (a notation is not a reason to refuse)", () => {
    for (const until of ["2026-09-27T10:00:00Z", "2026-09-27T10:00:00.123Z", "2026-09-27T10:00:00+02:00", "2026-09-27T10:00:00.5-05:30"]) {
      expect(SetMuteRequestSchema.safeParse({ until }).success, until).toBe(true);
    }
    for (const until of ["2026-09-27", "2026-09-27T10:00:00", "2026-09-27 10:00:00Z", ""]) {
      expect(SetMuteRequestSchema.safeParse({ until }).success, until).toBe(false);
    }
    const rule = { ...fixtures.alertRulesList.rules[0]!, createdAt: "2026-09-01T00:00:00+00:00" };
    expect(AlertRuleSchema.safeParse(rule).success).toBe(true);
  });

  it("query and target boundaries: limit 1 and 100, a 19-digit cursor, a target above zero and finite", () => {
    expect(AlertEventsQuerySchema.parse({ limit: "1" }).limit).toBe(1);
    expect(AlertEventsQuerySchema.safeParse({ before: "9".repeat(19) }).success).toBe(true);
    const target = (targetPerMinute: unknown) => ProductionBelowTargetParamsSchema.safeParse({ ...production, targetPerMinute }).success;
    expect([target(0.001), target(0), target(-1), target(Infinity), target(NaN), target("5")]).toEqual([true, false, false, false, false, false]);
    expect(ProductionBelowTargetUpdateParamsSchema.safeParse({ windowMinutes: 61 }).success).toBe(false);
    expect(ProductionBelowTargetUpdateParamsSchema.safeParse({ windowMinutes: 30 }).success).toBe(true);
  });
});

describe("alerts contract: errors", () => {
  const codes = ["rule_not_found", "rule_item_immutable", "preset_disable_only", "rule_kind_not_creatable", "destination_not_configured", "webhook_invalid", "delivery_off", "mute_invalid"];

  it("every new code is a known code and has an error fixture with a message that carries no URL", () => {
    const errors = [
      fixtures.errorRuleNotFound, fixtures.errorRuleItemImmutable, fixtures.errorPresetDisableOnly, fixtures.errorRuleKindNotCreatable,
      fixtures.errorDestinationNotConfigured, fixtures.errorWebhookInvalid, fixtures.errorDeliveryOff, fixtures.errorMuteInvalid,
    ];
    expect(errors.map((e) => e.error.code)).toEqual(codes);
    for (const code of codes) expect(KnownErrorCode.safeParse(code).success, code).toBe(true);
    for (const e of errors) expect(e.error.message).not.toMatch(/https?:|discord\.com|webhook\/|token/i);
  });

  it("webhook_invalid carries a stable `reason` that survives the envelope's parse", () => {
    expect(ApiErrorResponseSchema.parse(fixtures.errorWebhookInvalid).error.reason).toBe("host_not_allowed");
  });
});

describe("alerts contract: endpoints", () => {
  const all = [
    endpoints.alerts.rules.list, endpoints.alerts.rules.create, endpoints.alerts.rules.update, endpoints.alerts.rules.remove,
    endpoints.alerts.destinations.get, endpoints.alerts.destinations.putDiscord, endpoints.alerts.destinations.patchDiscord,
    endpoints.alerts.destinations.removeDiscord, endpoints.alerts.destinations.testDiscord,
    endpoints.alerts.events, endpoints.alerts.status, endpoints.alerts.mute.set, endpoints.alerts.mute.clear,
  ];

  it("every route is under /api/servers/:serverId/alerts, so the generated authorization tests cover it", () => {
    for (const endpoint of all) expect(endpoint.route.startsWith("/api/servers/:serverId/alerts/")).toBe(true);
  });

  it("the methods and routes are the documented ones", () => {
    expect(all.map((e) => `${e.method} ${e.route.replace("/api/servers/:serverId/alerts", "")}`)).toEqual([
      "GET /rules", "POST /rules", "PATCH /rules/:ruleId", "DELETE /rules/:ruleId",
      "GET /destinations", "PUT /destinations/discord", "PATCH /destinations/discord", "DELETE /destinations/discord", "POST /destinations/discord/test",
      "GET /events", "GET /status", "PUT /mute", "DELETE /mute",
    ]);
  });

  it("the path builders encode the ids", () => {
    expect(endpoints.alerts.rules.list.path("srv-1")).toBe("/api/servers/srv-1/alerts/rules");
    expect(endpoints.alerts.rules.update.path("srv-1", "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e04")).toBe("/api/servers/srv-1/alerts/rules/3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e04");
    expect(endpoints.alerts.rules.remove.path("srv-1", "a/b")).toBe("/api/servers/srv-1/alerts/rules/a%2Fb");
    expect(endpoints.alerts.destinations.testDiscord.path("srv-1")).toBe("/api/servers/srv-1/alerts/destinations/discord/test");
  });

  it("every write has a request schema, except the ones with no body", () => {
    const withBody = all.filter((e) => "request" in e).map((e) => `${e.method} ${e.route.split("/alerts")[1]}`);
    expect(withBody).toEqual(["POST /rules", "PATCH /rules/:ruleId", "PUT /destinations/discord", "PATCH /destinations/discord", "PUT /mute"]);
  });
});
