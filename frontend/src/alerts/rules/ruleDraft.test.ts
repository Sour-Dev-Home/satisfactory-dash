import { CreateAlertRuleRequestSchema, UpdateAlertRuleRequestSchema, type AlertRule } from "@satisfactory-dash/shared";
import { alertRulesList } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it } from "vitest";
import { buildCreate, buildUpdate, draftFrom, FIELD_HINT, kindLabel, NEW_TARGET, severityLabel } from "./ruleDraft";

const [outage, stopped, unreachable, production] = alertRulesList.rules as AlertRule[];

describe("draftFrom", () => {
  it("shows every duration in minutes, the server check's minimum included", () => {
    expect(draftFrom(unreachable)).toEqual({
      enabled: true,
      severity: "critical",
      forMinutes: "0",
      clearMinutes: "1",
      repeatMinutes: "60",
      params: { failedPolls: "3", minMinutes: "2" },
    });
  });

  it("keeps a production rule's item, which the form shows read-only", () => {
    expect(draftFrom(production).params).toEqual({ item: "Desc_IronPlate_C", targetPerMinute: "120", windowMinutes: "10" });
  });

  it("gives an unknown kind no settings to edit", () => {
    expect(draftFrom({ ...outage, kind: "belt_jam", params: { belts: 3 } }).params).toEqual({});
  });
});

describe("buildUpdate", () => {
  it("returns nothing when nothing changed", () => {
    for (const rule of [outage, stopped, unreachable, production]) expect(buildUpdate(rule, draftFrom(rule))).toBeNull();
  });

  it("sends only what changed, in whole seconds", () => {
    const draft = { ...draftFrom(stopped), enabled: false, forMinutes: "7.5" };
    expect(buildUpdate(stopped, draft)).toEqual({ ok: true, request: { enabled: false, forSeconds: 450 } });
  });

  it("checks the bounds after rounding: half a minute of repeat is under the 60 s minimum", () => {
    expect(buildUpdate(stopped, { ...draftFrom(stopped), repeatMinutes: "0.5" })).toEqual({
      ok: false,
      errors: { repeatMinutes: FIELD_HINT.repeatMinutes },
    });
    expect(buildUpdate(stopped, { ...draftFrom(stopped), repeatMinutes: "1" })).toEqual({ ok: true, request: { repeatSeconds: 60 } });
  });

  it.each([
    ["forMinutes", "1441"],
    ["clearMinutes", "-1"],
    ["repeatMinutes", "10081"],
    ["forMinutes", "abc"],
    ["clearMinutes", ""],
  ] as const)("refuses %s = %j", (field, value) => {
    const result = buildUpdate(stopped, { ...draftFrom(stopped), [field]: value });
    expect(result).toEqual({ ok: false, errors: { [field]: FIELD_HINT[field] } });
  });

  it("sends the stopped-machines threshold", () => {
    const draft = { ...draftFrom(stopped), params: { stoppedBelowPercent: "10" } };
    expect(buildUpdate(stopped, draft)).toEqual({ ok: true, request: { params: { stoppedBelowPercent: 10 } } });
    const bad = { ...draftFrom(stopped), params: { stoppedBelowPercent: "101" } };
    expect(buildUpdate(stopped, bad)).toEqual({ ok: false, errors: { stoppedBelowPercent: FIELD_HINT.stoppedBelowPercent } });
  });

  it("sends the server check's minimum in seconds, with its poll count", () => {
    const draft = { ...draftFrom(unreachable), params: { failedPolls: "3", minMinutes: "5" } };
    expect(buildUpdate(unreachable, draft)).toEqual({ ok: true, request: { params: { failedPolls: 3, minSeconds: 300 } } });
    const bad = { ...draftFrom(unreachable), params: { failedPolls: "2.5", minMinutes: "5" } };
    expect(buildUpdate(unreachable, bad)).toEqual({ ok: false, errors: { failedPolls: FIELD_HINT.failedPolls } });
  });

  it("never sends a production rule's item, only its target and window", () => {
    const draft = { ...draftFrom(production), params: { item: "Desc_Wire_C", targetPerMinute: "90", windowMinutes: "10" } };
    const result = buildUpdate(production, draft);
    expect(result).toEqual({ ok: true, request: { params: { targetPerMinute: 90, windowMinutes: 10 } } });
    if (result?.ok) expect(UpdateAlertRuleRequestSchema.safeParse(result.request).success).toBe(true);
  });

  it.each([
    ["targetPerMinute", "0"],
    ["targetPerMinute", "-5"],
    ["windowMinutes", "4"],
    ["windowMinutes", "61"],
  ] as const)("refuses a production %s of %s", (field, value) => {
    const draft = { ...draftFrom(production), params: { ...draftFrom(production).params, [field]: value } };
    expect(buildUpdate(production, draft)).toEqual({ ok: false, errors: { [field]: FIELD_HINT[field] } });
  });

  it("keeps an unknown severity unless the user picks another, and never touches an unknown kind's params", () => {
    const odd: AlertRule = { ...outage, kind: "belt_jam", severity: "page-me", params: { belts: 3 } };
    expect(buildUpdate(odd, draftFrom(odd))).toBeNull();
    expect(buildUpdate(odd, { ...draftFrom(odd), severity: "info" })).toEqual({ ok: true, request: { severity: "info" } });
    expect(buildUpdate(odd, { ...draftFrom(odd), enabled: false })).toEqual({ ok: true, request: { enabled: false } });
  });
});

describe("buildCreate", () => {
  it("sends the item, target and window, and lets the contract fill the timing", () => {
    const result = buildCreate({ ...NEW_TARGET, item: "Desc_IronPlate_C", targetPerMinute: "120" });
    expect(result).toEqual({
      ok: true,
      request: { kind: "production_below_target", params: { item: "Desc_IronPlate_C", targetPerMinute: 120, windowMinutes: 10 } },
    });
    if (result.ok) {
      expect(CreateAlertRuleRequestSchema.parse(result.request)).toMatchObject({ forSeconds: 600, clearSeconds: 300, repeatSeconds: 3600, severity: "warning" });
    }
  });

  it("sends a severity only when the user changed it", () => {
    const result = buildCreate({ ...NEW_TARGET, item: "Desc_IronPlate_C", targetPerMinute: "1", severity: "critical" });
    expect(result.ok && result.request.severity).toBe("critical");
  });

  it("says what's missing or out of range", () => {
    expect(buildCreate(NEW_TARGET)).toEqual({
      ok: false,
      errors: { item: FIELD_HINT.item, targetPerMinute: FIELD_HINT.targetPerMinute },
    });
    expect(buildCreate({ ...NEW_TARGET, item: "Desc_IronPlate_C", targetPerMinute: "5", windowMinutes: "90" })).toEqual({
      ok: false,
      errors: { windowMinutes: FIELD_HINT.windowMinutes },
    });
  });
});

describe("buildUpdate: rounding, formatting and malformed-stored-params edge cases", () => {
  it("rounds 0.99 minutes of repeat down to 59 s, still under the 60 s minimum", () => {
    expect(buildUpdate(stopped, { ...draftFrom(stopped), repeatMinutes: "0.99" })).toEqual({
      ok: false,
      errors: { repeatMinutes: FIELD_HINT.repeatMinutes },
    });
  });

  it("rounds 1440.004 minutes down to exactly the 86,400 s ceiling (accepted)", () => {
    expect(buildUpdate(outage, { ...draftFrom(outage), forMinutes: "1440.004" })).toEqual({
      ok: true,
      request: { forSeconds: 86_400 },
    });
  });

  it("rounds 1440.01 minutes up past the ceiling (refused)", () => {
    expect(buildUpdate(outage, { ...draftFrom(outage), forMinutes: "1440.01" })).toEqual({
      ok: false,
      errors: { forMinutes: FIELD_HINT.forMinutes },
    });
  });

  it("treats -0 minutes as unchanged (no spurious diff against a stored 0)", () => {
    expect(buildUpdate(outage, { ...draftFrom(outage), forMinutes: "-0" })).toBeNull();
  });

  it("accepts scientific notation, since Number() does: 1e3 failed polls is 1000, within bounds", () => {
    const draft = { ...draftFrom(unreachable), params: { ...draftFrom(unreachable).params, failedPolls: "1e3" } };
    expect(buildUpdate(unreachable, draft)).toEqual({ ok: true, request: { params: { failedPolls: 1000, minSeconds: 120 } } });
  });

  it("refuses a locale-formatted number with a thousands comma", () => {
    const draft = { ...draftFrom(production), params: { ...draftFrom(production).params, targetPerMinute: "1,200" } };
    expect(buildUpdate(production, draft)).toEqual({ ok: false, errors: { targetPerMinute: FIELD_HINT.targetPerMinute } });
  });

  it("trims surrounding whitespace", () => {
    const draft = { ...draftFrom(stopped), params: { stoppedBelowPercent: " 8 " } };
    expect(buildUpdate(stopped, draft)).toEqual({ ok: true, request: { params: { stoppedBelowPercent: 8 } } });
  });

  it("gives no editable params for a rule whose stored params fail its own kind's schema, but still lets other fields change", () => {
    const badTarget: AlertRule = { ...production, params: { item: "Desc_IronPlate_C", targetPerMinute: -5, windowMinutes: 10 } };
    expect(draftFrom(badTarget).params).toEqual({});
    expect(buildUpdate(badTarget, draftFrom(badTarget))).toBeNull();
    expect(buildUpdate(badTarget, { ...draftFrom(badTarget), severity: "critical" })).toEqual({
      ok: true,
      request: { severity: "critical" },
    });
  });

  // Found by the test-hunter: params were compared as text, so "5.0" for a stored 5 sent a PATCH that changed
  // nothing. They're compared as numbers now, like the durations.
  it("doesn't count a reformatted-but-equal param value as a change", () => {
    expect(buildUpdate(stopped, { ...draftFrom(stopped), params: { stoppedBelowPercent: "5.0" } })).toBeNull();
    expect(buildUpdate(unreachable, { ...draftFrom(unreachable), params: { failedPolls: "3.0", minMinutes: "2.00" } })).toBeNull();
    const productionDraft = draftFrom(production);
    expect(buildUpdate(production, { ...productionDraft, params: { ...productionDraft.params, targetPerMinute: "120.0" } })).toBeNull();
  });
});

describe("labels", () => {
  it("names the known kinds and keeps an unknown one's own name", () => {
    expect(kindLabel("server_unreachable")).toBe("Game server unreachable");
    expect(kindLabel("belt_jam")).toBe("Rule: belt_jam");
    expect(severityLabel("critical")).toBe("Critical");
    expect(severityLabel("page-me")).toBe("page-me");
  });
});
