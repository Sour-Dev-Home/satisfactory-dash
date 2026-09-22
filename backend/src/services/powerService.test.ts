import { describe, it, expect } from "vitest";
import { PowerService, classifyPowerCircuit } from "./powerService.js";
import type { PowerAdapterLike } from "./powerService.js";
import type { PowerCircuit } from "../adapters/domain.js";

function circuit(overrides: Partial<PowerCircuit> = {}): PowerCircuit {
  return {
    circuitGroupId: 0,
    powerProduction: 100,
    powerConsumed: 50,
    powerCapacity: 100,
    maxPowerConsumed: 100,
    fuseTriggered: false,
    batteryPercent: 50,
    batteryDifferential: 0,
    batteryCapacity: 100,
    ...overrides,
  };
}

describe("classifyPowerCircuit", () => {
  it("is outage when the fuse has tripped", () => {
    expect(classifyPowerCircuit(circuit({ fuseTriggered: true }))).toBe("outage");
  });

  // docs-vault/wiki/frm-api.md calls only FuseTriggered "a direct outage signal";
  // over-capacity draw is described there as "heading toward an outage" (i.e.
  // at_risk), since batteries may still be covering the gap. Classifying it as
  // outage outright would make the at_risk branch below unreachable in any real
  // deficit, since demand only outruns generation when consumption > capacity.
  it("is at_risk (not outage) when consumption exceeds capacity but the fuse hasn't tripped", () => {
    expect(classifyPowerCircuit(circuit({ powerConsumed: 150, powerCapacity: 100, fuseTriggered: false }))).toBe(
      "at_risk",
    );
  });

  it("is outage, not at_risk, once the fuse actually trips on an over-capacity circuit", () => {
    expect(classifyPowerCircuit(circuit({ powerConsumed: 150, powerCapacity: 100, fuseTriggered: true }))).toBe(
      "outage",
    );
  });

  // Found by a review pass: this test used to combine powerConsumed > powerCapacity
  // WITH draining batteries in one fixture, so it passed via the capacity branch
  // regardless of the battery values -- it never actually exercised the battery
  // branch below despite its name implying it did. Keeping the over-capacity-plus-
  // battery-drain case (still a real, worth-covering scenario) but asserting via a
  // fixture where the capacity branch demonstrably isn't what's firing.
  it("is at_risk on a genuine deficit (over capacity, batteries also draining)", () => {
    const c = circuit({ powerProduction: 100, powerConsumed: 150, powerCapacity: 100, batteryDifferential: -50, batteryPercent: 10 });
    expect(classifyPowerCircuit(c)).toBe("at_risk");
  });

  // Isolates the battery branch specifically: consumption is within nominal
  // capacity, so the capacity check does NOT fire, yet batteries are still
  // draining. See the reachability discussion on classifyPowerCircuit's doc
  // comment -- this models PowerCapacity (nominal/rated) diverging from actual
  // PowerProduction (e.g. a generator idle or fuel-starved), which nothing in
  // docs-vault rules out.
  it("is at_risk when batteries are draining and below the threshold, even though consumption is within nominal capacity", () => {
    const c = circuit({ powerConsumed: 50, powerCapacity: 100, batteryDifferential: -5, batteryPercent: 10 });
    expect(classifyPowerCircuit(c)).toBe("at_risk");
  });

  it("is ok when batteries are draining but still above the threshold", () => {
    expect(classifyPowerCircuit(circuit({ batteryDifferential: -5, batteryPercent: 50 }))).toBe("ok");
  });

  it("is ok when battery percent is low but batteries are charging, not draining", () => {
    expect(classifyPowerCircuit(circuit({ batteryDifferential: 5, batteryPercent: 5 }))).toBe("ok");
  });

  it("is ok at the exact threshold boundary (strictly less-than, not less-than-or-equal)", () => {
    expect(classifyPowerCircuit(circuit({ batteryDifferential: -1, batteryPercent: 20 }))).toBe("ok");
  });

  it("is ok for a plain steady-state circuit", () => {
    expect(classifyPowerCircuit(circuit())).toBe("ok");
  });

  // frm-getPower.md's own example response has PowerCapacity: 0, PowerConsumed: 0
  // together (a circuit with no generators connected yet) — confirming `powerConsumed
  // > powerCapacity` (strict) rather than `>=` is the right boundary, since an
  // idle/empty circuit at 0/0 must not read as an outage.
  it("is ok when consumption exactly equals capacity (strictly greater-than, not greater-or-equal)", () => {
    expect(classifyPowerCircuit(circuit({ powerConsumed: 100, powerCapacity: 100 }))).toBe("ok");
  });

  it("outage takes precedence over at_risk when both conditions are true", () => {
    const c = circuit({ fuseTriggered: true, batteryDifferential: -10, batteryPercent: 1 });
    expect(classifyPowerCircuit(c)).toBe("outage");
  });

  it("is ok, not outage, for an idle circuit with zero capacity and zero consumption (matches frm-getPower.md's example response)", () => {
    expect(classifyPowerCircuit(circuit({ powerConsumed: 0, powerCapacity: 0, powerProduction: 0 }))).toBe("ok");
  });

  // Found by a second review pass: every comparison against NaN is false, so a
  // missing/malformed numeric field from FRM (nothing validates rawTypes.ts's `as`
  // cast at runtime -- see docs-vault/wiki/lessons-learned.md) used to fall through
  // to "ok" silently instead of raising at_risk. Not fixTriggered's problem to catch
  // (it's a separate boolean field) -- this covers the four numeric fields the
  // function itself reads.
  it("is at_risk, not ok, when powerConsumed is NaN rather than silently passing every comparison", () => {
    expect(classifyPowerCircuit(circuit({ powerConsumed: Number.NaN }))).toBe("at_risk");
  });

  it("is at_risk, not ok, when powerCapacity is NaN", () => {
    expect(classifyPowerCircuit(circuit({ powerCapacity: Number.NaN }))).toBe("at_risk");
  });

  it("is at_risk, not ok, when batteryDifferential is NaN", () => {
    expect(classifyPowerCircuit(circuit({ batteryDifferential: Number.NaN }))).toBe("at_risk");
  });

  it("is at_risk, not ok, when batteryPercent is NaN", () => {
    expect(classifyPowerCircuit(circuit({ batteryPercent: Number.NaN }))).toBe("at_risk");
  });

  // Found by a sixth review pass: the validation block covered every numeric field
  // classifyPowerCircuit actually compares, but not powerProduction, which the
  // function never compares against anything -- yet getPowerOverview separately
  // sanitizes it to a clean-looking 0 in the response. A NaN there used to come
  // back as status: "ok" with powerProduction: 0, exactly the "bad data read as
  // ok" outcome this whole validation block exists to prevent.
  it("is at_risk, not ok, when powerProduction is NaN even though it isn't otherwise compared", () => {
    expect(classifyPowerCircuit(circuit({ powerProduction: Number.NaN }))).toBe("at_risk");
  });

  it("a tripped fuse still wins over a NaN field elsewhere", () => {
    expect(classifyPowerCircuit(circuit({ fuseTriggered: true, powerConsumed: Number.NaN }))).toBe("outage");
  });

  // Found by a third review pass: the previous version used `if (circuit.
  // fuseTriggered)`, which is truthy for the STRING "false" -- a malformed value
  // from unvalidated FRM data (docs-vault/wiki/lessons-learned.md) would misread as
  // a real outage. Now only a strict `=== true` counts as outage; anything else
  // that isn't a real boolean falls into the defensive at_risk bucket instead.
  it("is at_risk, not outage, when fuseTriggered is the truthy string 'false' rather than a real boolean", () => {
    const c = { ...circuit(), fuseTriggered: "false" as unknown as boolean };
    expect(classifyPowerCircuit(c)).toBe("at_risk");
  });

  it("is at_risk, not ok, when fuseTriggered is a non-boolean falsy value like 0", () => {
    const c = { ...circuit(), fuseTriggered: 0 as unknown as boolean };
    expect(classifyPowerCircuit(c)).toBe("at_risk");
  });

  it("a real fuseTriggered: false still reaches ok/at_risk logic normally", () => {
    expect(classifyPowerCircuit(circuit({ fuseTriggered: false }))).toBe("ok");
  });
});

describe("PowerService", () => {
  it("maps circuits and flags hasOutage when any circuit is in outage", async () => {
    const adapter: PowerAdapterLike = {
      getPowerCircuits: async () => [circuit({ circuitGroupId: 0 }), circuit({ circuitGroupId: 1, fuseTriggered: true })],
    };
    const service = new PowerService(adapter);
    const overview = await service.getPowerOverview();
    expect(overview.hasOutage).toBe(true);
    expect(overview.circuits.map((c) => [c.circuitGroupId, c.status])).toEqual([
      [0, "ok"],
      [1, "outage"],
    ]);
  });

  it("does not flag hasOutage when no circuit is in outage", async () => {
    const adapter: PowerAdapterLike = { getPowerCircuits: async () => [circuit()] };
    const service = new PowerService(adapter);
    await expect(service.getPowerOverview()).resolves.toMatchObject({ hasOutage: false });
  });

  // hasOutage is defined (services/powerService.ts) as `.some(status === "outage")` —
  // an all-at_risk fleet of circuits (batteries draining, none tripped/over-capacity
  // yet) must NOT set hasOutage, even though every circuit is degraded. Confirms the
  // route/UI can't conflate "at risk" with "outage" via this flag.
  it("does not flag hasOutage when every circuit is at_risk but none is an outage", async () => {
    const adapter: PowerAdapterLike = {
      getPowerCircuits: async () => [
        circuit({ circuitGroupId: 0, batteryDifferential: -1, batteryPercent: 5 }),
        circuit({ circuitGroupId: 1, batteryDifferential: -1, batteryPercent: 5 }),
      ],
    };
    const service = new PowerService(adapter);
    const overview = await service.getPowerOverview();
    expect(overview.hasOutage).toBe(false);
    expect(overview.circuits.every((c) => c.status === "at_risk")).toBe(true);
  });

  it("returns an empty overview for zero circuits", async () => {
    const adapter: PowerAdapterLike = { getPowerCircuits: async () => [] };
    const service = new PowerService(adapter);
    await expect(service.getPowerOverview()).resolves.toEqual({ circuits: [], hasOutage: false });
  });

  // Found by a fourth review pass: classifyPowerCircuit correctly treats malformed
  // fields as at_risk, but getPowerOverview used to copy the RAW malformed values
  // straight into PowerCircuitResponse -- a string in a field packages/shared
  // declares as `boolean`, or a NaN that becomes JSON `null` in a field declared as
  // `number`. That's a contract leak (ground rule 5): the response no longer
  // actually matches its own declared type at runtime. Sanitize to safe defaults
  // for the response while still classifying off the raw circuit. Fallback is
  // `false` -- a sixth pass changed this to `true` reasoning an alarm field should
  // fail toward the alarm, but an eighth pass caught that this made the response
  // self-contradictory (fuseTriggered: true alongside status: "at_risk", not
  // "outage", and hasOutage: false all disagreeing at once), which is worse than
  // either single direction. Reverted; `status` alone carries the alert.
  it("sanitizes a malformed fuseTriggered to false in the response, consistent with status: at_risk (not outage)", async () => {
    const bad = { ...circuit(), fuseTriggered: "false" as unknown as boolean };
    const adapter: PowerAdapterLike = { getPowerCircuits: async () => [bad] };
    const service = new PowerService(adapter);
    const overview = await service.getPowerOverview();
    expect(overview.circuits[0].fuseTriggered).toBe(false);
    expect(typeof overview.circuits[0].fuseTriggered).toBe("boolean");
    expect(overview.circuits[0].status).toBe("at_risk");
  });

  it("sanitizes a NaN numeric field to 0 in the response, while still classifying it as at_risk", async () => {
    const bad = circuit({ powerConsumed: Number.NaN });
    const adapter: PowerAdapterLike = { getPowerCircuits: async () => [bad] };
    const service = new PowerService(adapter);
    const overview = await service.getPowerOverview();
    expect(overview.circuits[0].powerConsumed).toBe(0);
    expect(Number.isFinite(overview.circuits[0].powerConsumed)).toBe(true);
    expect(overview.circuits[0].status).toBe("at_risk");
  });

  // Found by a fifth review pass: circuitGroupId went through every other field's
  // finiteOr treatment except itself, so a NaN there still became JSON null on the
  // wire despite PowerCircuitResponse declaring it a number. -1 (not 0) is the
  // right fallback since 0 could collide with a real circuit's actual id -- FRM
  // documents -1 as "not connected" for this exact field
  // (docs-vault/raw-sources/frm-getFactory.md), already used the same way for
  // FactoryBuilding.circuitId.
  it("sanitizes a NaN circuitGroupId to -1 (FRM's own not-connected sentinel), not 0", async () => {
    const bad = circuit({ circuitGroupId: Number.NaN });
    const adapter: PowerAdapterLike = { getPowerCircuits: async () => [bad] };
    const service = new PowerService(adapter);
    const overview = await service.getPowerOverview();
    expect(overview.circuits[0].circuitGroupId).toBe(-1);
  });

  it("leaves well-formed values untouched", async () => {
    const adapter: PowerAdapterLike = { getPowerCircuits: async () => [circuit({ powerConsumed: 42, fuseTriggered: false })] };
    const service = new PowerService(adapter);
    const overview = await service.getPowerOverview();
    expect(overview.circuits[0].powerConsumed).toBe(42);
    expect(overview.circuits[0].fuseTriggered).toBe(false);
  });

  // Found by a seventh review pass: a null/non-object entry in the circuits array
  // itself (not just a bad field on an otherwise-real circuit) crashed the whole
  // overview via a TypeError, rather than just being unreadable on its own. Not
  // reachable from today's real adapter, but this service already describes
  // itself as defensive against unvalidated FRM data. A ninth pass caught that the
  // first fix (filtering the null out) made it vanish silently -- the wrong
  // direction for an alarm, since every other malformed-data case here shows up
  // as at_risk instead of disappearing. It's now shown as a placeholder at_risk
  // entry rather than skipped.
  it("shows a null entry in the circuits array as a placeholder at_risk circuit, instead of dropping it or crashing", async () => {
    const adapter: PowerAdapterLike = {
      getPowerCircuits: async () => [circuit({ circuitGroupId: 0 }), null as unknown as PowerCircuit],
    };
    const service = new PowerService(adapter);
    const overview = await service.getPowerOverview();
    expect(overview.circuits).toHaveLength(2);
    expect(overview.circuits[0].circuitGroupId).toBe(0);
    expect(overview.circuits[1]).toMatchObject({ circuitGroupId: -1, status: "at_risk" });
  });

  // Found by a tenth review pass: Array.prototype.map SKIPS holes in a sparse
  // array rather than calling the callback with undefined for them, so a hole
  // bypassed the null/non-object placeholder logic entirely and came out as a raw
  // JSON null in the response -- contradicting this method's own rule that every
  // malformed entry shows up as at_risk. Not reachable through the real adapter
  // (JSON.parse can't produce a sparse array), but worth closing defensively.
  it("shows a hole in a sparse circuits array as a placeholder at_risk circuit too", async () => {
    const sparse: PowerCircuit[] = [circuit({ circuitGroupId: 0 }), circuit({ circuitGroupId: 1 })];
    delete (sparse as unknown[])[1]; // creates an actual array hole, not `undefined`
    const adapter: PowerAdapterLike = { getPowerCircuits: async () => sparse };
    const service = new PowerService(adapter);
    const overview = await service.getPowerOverview();
    expect(overview.circuits).toHaveLength(2);
    expect(overview.circuits[1]).toMatchObject({ circuitGroupId: -1, status: "at_risk" });
    expect(overview.circuits[1]).not.toBeNull();
  });
});
