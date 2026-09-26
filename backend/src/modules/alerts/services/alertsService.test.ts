import { describe, expect, it } from "vitest";
import { ApiFailure, BadRequestError } from "../../../platform/errorResponse.js";
import type { ApiRuleRow } from "../repositories/apiRepository.js";
import { MAX_MUTE_MS, planPatch, toApiRule, validateMuteUntil } from "./alertsService.js";

const T = new Date("2026-09-26T12:00:00.000Z");
const rule = (over: Partial<ApiRuleRow> = {}): ApiRuleRow => ({
  id: "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e04",
  kind: "production_below_target",
  params: { item: "Desc_IronPlate_C", targetPerMinute: 100, windowMinutes: 10 },
  forSeconds: 600,
  clearSeconds: 300,
  repeatSeconds: 3600,
  severity: "warning",
  enabled: true,
  preset: false,
  createdAt: T,
  updatedAt: T,
  ...over,
});

describe("planPatch (what a PATCH changes)", () => {
  it("merges the target and the window into the current params and keeps the item", () => {
    const plan = planPatch(rule(), { params: { targetPerMinute: 80, windowMinutes: 20 } });
    expect(plan).toMatchObject({ ok: true, next: { params: { item: "Desc_IronPlate_C", targetPerMinute: 80, windowMinutes: 20 } }, changed: ["params"] });
  });

  it("changing only the target keeps the window", () => {
    const plan = planPatch(rule(), { params: { targetPerMinute: 55 } });
    expect(plan.ok && plan.next.params).toEqual({ item: "Desc_IronPlate_C", targetPerMinute: 55, windowMinutes: 10 });
  });

  it("`item` is rule_item_immutable, even next to valid fields and even when it equals the current item", () => {
    for (const params of [{ item: "Desc_Other_C" }, { item: "Desc_IronPlate_C" }, { item: "Desc_Other_C", targetPerMinute: 5 }, { item: undefined }]) {
      const plan = planPatch(rule(), { enabled: false, params });
      expect(plan.ok).toBe(false);
      expect(!plan.ok && plan.failure).toBeInstanceOf(ApiFailure);
      expect(!plan.ok && (plan.failure as ApiFailure).code).toBe("rule_item_immutable");
    }
  });

  it("refuses invalid or unknown params as a bad_request, for every kind", () => {
    const bad: [Partial<ApiRuleRow>, Record<string, unknown>][] = [
      [{}, { targetPerMinute: 0 }],
      [{}, { targetPerMinute: Number.POSITIVE_INFINITY }],
      [{}, { windowMinutes: 4 }],
      [{}, { windowMinutes: 61 }],
      [{}, { windowMinutes: 7.5 }],
      [{}, { unknown: 1 }],
      [{}, {}],
      [{ kind: "stopped_machines", params: { stoppedBelowPercent: 5 } }, { stoppedBelowPercent: -1 }],
      [{ kind: "stopped_machines", params: { stoppedBelowPercent: 5 } }, { stoppedBelowPercent: 101 }],
      [{ kind: "server_unreachable", params: { failedPolls: 3, minSeconds: 120 } }, { failedPolls: 0 }],
      [{ kind: "server_unreachable", params: { failedPolls: 3, minSeconds: 120 } }, {}],
      [{ kind: "power_outage", params: {} }, { anything: 1 }],
      [{ kind: "fuse_trip", params: {} }, {}],
      [{ kind: "agent_offline", params: {} }, { anything: 1 }],
    ];
    for (const [over, params] of bad) {
      const plan = planPatch(rule(over), { params });
      expect(plan.ok, JSON.stringify([over.kind, params])).toBe(false);
      expect(!plan.ok && plan.failure).toBeInstanceOf(BadRequestError);
    }
  });

  it("tunes the presets' own params", () => {
    const stopped = planPatch(rule({ kind: "stopped_machines", params: { stoppedBelowPercent: 5 }, preset: true }), { params: { stoppedBelowPercent: 12 } });
    expect(stopped.ok && stopped.next.params).toEqual({ stoppedBelowPercent: 12 });
    const unreachable = planPatch(rule({ kind: "server_unreachable", params: { failedPolls: 3, minSeconds: 120 }, preset: true }), { params: { minSeconds: 300 } });
    expect(unreachable.ok && unreachable.next.params).toEqual({ failedPolls: 3, minSeconds: 300 });
  });

  it("changes only what was sent and lists exactly those fields", () => {
    const plan = planPatch(rule(), { severity: "critical", repeatSeconds: 7200 });
    expect(plan).toEqual({
      ok: true,
      next: { params: rule().params, enabled: true, severity: "critical", forSeconds: 600, clearSeconds: 300, repeatSeconds: 7200 },
      changed: ["severity", "repeatSeconds"],
    });
    const enabled = planPatch(rule({ enabled: false }), { enabled: true });
    expect(enabled.ok && enabled.next.enabled).toBe(true);
    const zero = planPatch(rule(), { forSeconds: 0, clearSeconds: 0 });
    expect(zero.ok && [zero.next.forSeconds, zero.next.clearSeconds]).toEqual([0, 0]); // 0 is a value, not "not sent"
  });

  it("`enabled: false` disables an enabled rule (false is a value, not 'not sent')", () => {
    const plan = planPatch(rule({ enabled: true }), { enabled: false });
    expect(plan.ok && plan.next.enabled).toBe(false);
    expect(plan.ok && plan.changed).toEqual(["enabled"]);
  });

  it("cannot smuggle an item or extra keys through casing, nesting or prototype keys (what comes from JSON.parse)", () => {
    const hostile = [
      '{"Item":"Desc_Other_C","targetPerMinute":5}',
      '{"params":{"item":"Desc_Other_C"},"targetPerMinute":5}',
      '{"constructor":{"item":"Desc_Other_C"},"targetPerMinute":5}',
      '{"__proto__":{"item":"Desc_Other_C"},"targetPerMinute":5}',
      '{"targetPerMinute":5,"windowMinutes":"10"}',
      '{"targetPerMinute":null}',
    ];
    for (const json of hostile) {
      const plan = planPatch(rule(), { params: JSON.parse(json) as Record<string, unknown> });
      if (plan.ok) expect(plan.next.params, json).toEqual({ item: "Desc_IronPlate_C", targetPerMinute: 5, windowMinutes: 10 });
      else expect(plan.failure, json).toBeInstanceOf(BadRequestError);
    }
    expect(({} as Record<string, unknown>).item).toBeUndefined(); // nothing polluted Object.prototype
  });

  it("does not mutate the rule it was given", () => {
    const original = rule();
    const before = JSON.stringify(original);
    planPatch(original, { params: { targetPerMinute: 1 }, enabled: false });
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe("validateMuteUntil", () => {
  const now = T.getTime();
  it("accepts a time in the future up to exactly 7 days ahead", () => {
    expect(validateMuteUntil(new Date(now + 1).toISOString(), now)?.getTime()).toBe(now + 1);
    expect(validateMuteUntil(new Date(now + MAX_MUTE_MS).toISOString(), now)?.getTime()).toBe(now + MAX_MUTE_MS);
  });
  it("refuses now, the past, more than 7 days, and anything that is not a time", () => {
    for (const bad of [new Date(now).toISOString(), new Date(now - 1).toISOString(), new Date(now + MAX_MUTE_MS + 1).toISOString(), "", "tomorrow", "Invalid Date", "0000-00-00T00:00:00Z"]) {
      expect(validateMuteUntil(bad, now), bad).toBeUndefined();
    }
  });
  it("understands an offset", () => {
    expect(validateMuteUntil("2026-09-26T14:30:00+02:00", now)?.toISOString()).toBe("2026-09-26T12:30:00.000Z");
  });
});

describe("toApiRule", () => {
  it("turns dates into ISO strings and keeps every field", () => {
    expect(toApiRule(rule())).toEqual({
      id: "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e04",
      kind: "production_below_target",
      params: { item: "Desc_IronPlate_C", targetPerMinute: 100, windowMinutes: 10 },
      forSeconds: 600,
      clearSeconds: 300,
      repeatSeconds: 3600,
      severity: "warning",
      enabled: true,
      preset: false,
      createdAt: "2026-09-26T12:00:00.000Z",
      updatedAt: "2026-09-26T12:00:00.000Z",
    });
  });
});
