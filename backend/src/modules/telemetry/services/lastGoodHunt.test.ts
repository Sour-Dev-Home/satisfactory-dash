import { describe, expect, it } from "vitest";
import { ApiFailure } from "../../../platform/errorResponse.js";
import { snapshot } from "../../../platform/snapshot.js";
import { LatestSnapshotStore } from "./agentSnapshotStore.js";
import { withLastGood } from "./lastGood.js";

const T0 = Date.parse("2026-10-24T10:00:00.000Z");
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const iso = (ms: number) => new Date(ms).toISOString();

describe("withLastGood hunt", () => {
  it.each(["upstream_auth_rejected", "upstream_invalid_response", "upstream_error"] as const)("%s still throws with a remembered value", async (code) => {
    let n = 0;
    const read = withLastGood(async () => {
      if (n++ === 0) return { a: 1 };
      throw new ApiFailure(code as never, "x");
    });
    await read();
    await expect(read()).rejects.toMatchObject({ code });
  });

  it("two wrappers do not share memory", async () => {
    const a = withLastGood(async () => ({ v: "a" }));
    const b = withLastGood(async () => {
      throw new ApiFailure("upstream_unreachable", "d");
    });
    await a();
    await expect(b()).rejects.toMatchObject({ code: "upstream_unreachable" });
  });

  it("does not leak a stale mark into a later fresh success (same object returned)", async () => {
    const obj = { v: 1 };
    let fail = false;
    let t = T0;
    const read = withLastGood(async () => {
      if (fail) throw new ApiFailure("upstream_unreachable", "d");
      return obj;
    }, () => t);
    await read();
    fail = true;
    t += 1000;
    expect(snapshot("s", await read()).stale).toBe(true);
    fail = false;
    const fresh = snapshot("s", await read());
    expect(fresh.stale).toBe(false);
    expect(fresh).not.toHaveProperty("unreachableSince");
  });
});

describe("LatestSnapshotStore hunt", () => {
  const rec = (s: LatestSnapshotStore, reachable: boolean, at: number, extra: object = {}) =>
    s.record({ reachable, observedAtMs: at, receivedAtMs: at, ...extra });

  it("per-part: unreachable serves only stored parts; others throw", () => {
    const s = new LatestSnapshotStore(() => CADENCE, () => T0 + 1000);
    rec(s, true, T0, { status: { sessionName: "x" } });
    rec(s, false, T0 + 500);
    expect(snapshot("s", s.read("status")).stale).toBe(true);
    expect(() => s.read("power")).toThrow(/could not be reached/);
    expect(() => s.read("power", { circuits: [] } as never)).toThrow();
  });

  it("an unreachable snapshot never overwrites parts or auto-pause", () => {
    const s = new LatestSnapshotStore(() => CADENCE, () => T0 + 1000);
    rec(s, true, T0, { status: { sessionName: "x" }, autoPause: true });
    rec(s, false, T0 + 500, { status: { sessionName: "y" }, autoPause: false });
    expect(s.read("status")).toMatchObject({ sessionName: "x" });
    expect(s.autoPause()?.autoPause).toBe(true);
  });

  it("a late older reachable snapshot arriving during an outage must not end it", () => {
    const s = new LatestSnapshotStore(() => CADENCE, () => T0 + 20_000);
    rec(s, true, T0 + 1000, { status: { sessionName: "new" } });
    rec(s, false, T0 + 10_000);
    rec(s, true, T0 + 2000, { status: { sessionName: "old" } }); // retried older snapshot
    expect(snapshot("s", s.read("status"))).toMatchObject({ stale: true, unreachableSince: iso(T0 + 10_000) });
  });

  it("stores are isolated from each other", () => {
    const a = new LatestSnapshotStore(() => CADENCE, () => T0);
    const b = new LatestSnapshotStore(() => CADENCE, () => T0);
    rec(a, true, T0, { status: { sessionName: "a" } });
    rec(a, false, T0 + 1);
    expect(() => b.read("status")).toThrow();
  });
});
