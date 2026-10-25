import { describe, expect, it } from "vitest";
import { ApiFailure } from "../../../platform/errorResponse.js";
import { snapshot } from "../../../platform/snapshot.js";
import { withLastGood } from "./lastGood.js";

const T0 = Date.parse("2026-10-24T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A read that answers from a script: a value, or an error to throw. */
function scripted(steps: Array<{ ok: object } | { fail: unknown }>) {
  let i = 0;
  return async () => {
    const step = steps[Math.min(i++, steps.length - 1)]!;
    if ("fail" in step) throw step.fail;
    return step.ok;
  };
}
const down = () => new ApiFailure("upstream_unreachable", "down");

describe("withLastGood (ADR-0052 1.3)", () => {
  it("passes a success through untouched (fresh, no mark)", async () => {
    const value = { n: 1 };
    const read = withLastGood(scripted([{ ok: value }]), () => T0);
    const got = await read();
    expect(got).toBe(value);
    expect(snapshot("x", got)).toMatchObject({ stale: false });
    expect("unreachableSince" in snapshot("x", got)).toBe(false);
  });

  it("serves the last success stale, with its own time and the first failure time, while unreachable", async () => {
    let clock = T0;
    const read = withLastGood(scripted([{ ok: { n: 1 } }, { fail: down() }, { fail: down() }]), () => clock);
    await read();
    clock = T0 + 5000;
    const first = snapshot("x", await read());
    clock = T0 + 10_000;
    const second = snapshot("x", await read());
    expect(first).toMatchObject({ data: { n: 1 }, observedAt: iso(T0), stale: true, unreachableSince: iso(T0 + 5000) });
    expect(second).toMatchObject({ observedAt: iso(T0), stale: true, unreachableSince: iso(T0 + 5000) });
  });

  it("clears the outage on the next success, and a later outage starts its own run", async () => {
    let clock = T0;
    const read = withLastGood(scripted([{ ok: { n: 1 } }, { fail: down() }, { ok: { n: 2 } }, { fail: down() }]), () => clock);
    await read();
    clock = T0 + 1000;
    await read();
    clock = T0 + 2000;
    expect(snapshot("x", await read())).toMatchObject({ data: { n: 2 }, stale: false });
    clock = T0 + 3000;
    expect(snapshot("x", await read())).toMatchObject({ data: { n: 2 }, observedAt: iso(T0 + 2000), stale: true, unreachableSince: iso(T0 + 3000) });
  });

  it("does not mutate the remembered value", async () => {
    const value = { n: 1 };
    const read = withLastGood(scripted([{ ok: value }, { fail: down() }]), () => T0);
    await read();
    await read();
    expect(Object.keys(value)).toEqual(["n"]);
  });

  it("rethrows upstream_unreachable when nothing was remembered", async () => {
    const read = withLastGood(scripted([{ fail: down() }]), () => T0);
    await expect(read()).rejects.toMatchObject({ code: "upstream_unreachable" });
  });

  it.each([
    ["upstream_auth_rejected", new ApiFailure("upstream_auth_rejected", "no")],
    ["upstream_invalid_response", new ApiFailure("upstream_invalid_response", "bad")],
    ["upstream_error", new ApiFailure("upstream_error", "boom")],
  ])("still throws %s even with a remembered value", async (_name, failure) => {
    const read = withLastGood(scripted([{ ok: { n: 1 } }, { fail: failure }]), () => T0);
    await read();
    await expect(read()).rejects.toBe(failure);
  });

  it("rethrows a non-ApiFailure error", async () => {
    const boom = new TypeError("bug");
    const read = withLastGood(scripted([{ ok: { n: 1 } }, { fail: boom }]), () => T0);
    await read();
    await expect(read()).rejects.toBe(boom);
  });

  it("a fault answer ends the outage run: the next unreachable restarts the time", async () => {
    let clock = T0;
    const read = withLastGood(
      scripted([{ ok: { n: 1 } }, { fail: down() }, { fail: new ApiFailure("upstream_auth_rejected", "no") }, { fail: down() }]),
      () => clock,
    );
    await read();
    clock = T0 + 1000;
    await read();
    clock = T0 + 2000;
    await expect(read()).rejects.toMatchObject({ code: "upstream_auth_rejected" });
    clock = T0 + 3000;
    expect(snapshot("x", await read()).unreachableSince).toBe(iso(T0 + 3000));
  });
});
