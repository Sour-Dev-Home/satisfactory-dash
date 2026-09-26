import { describe, expect, it, vi } from "vitest";
import { FrmApiClient } from "./frmApiClient.js";
import type { UpstreamCall } from "./connection.js";
import { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
import { timedCall } from "./upstreamTiming.js";
import { VanillaApiClient } from "./vanillaApiClient.js";
import type { VanillaApiTransport } from "./vanillaApiClient.js";

// ADR-0032 step 1: every request to the game server tells a listener how long it ran, so the backend can split a
// request's time into "app" and "upstream". The listener never changes what a request does.

const okTransport: VanillaApiTransport = async () => ({ status: 200, body: { data: { ok: true } } });
const vanilla = (transport: VanillaApiTransport, onCall?: (call: UpstreamCall) => void) =>
  new VanillaApiClient({ host: "127.0.0.1", port: 7777, allowSelfSignedCert: true, timeoutMs: 1000, transport, onCall });
const frm = (fetchImpl: (url: string, init: RequestInit) => Promise<Response>, onCall?: (call: UpstreamCall) => void) =>
  new FrmApiClient({ host: "127.0.0.1", port: 8080, timeoutMs: 1000, fetchImpl, onCall });

describe("timedCall", () => {
  it("reports one interval on the monotonic clock, and passes the result through", async () => {
    const calls: UpstreamCall[] = [];
    const before = performance.now();
    const result = await timedCall("frm", (call) => calls.push(call), async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 42;
    });
    expect(result).toBe(42);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.upstream).toBe("frm");
    expect(calls[0]!.startMs).toBeGreaterThanOrEqual(before);
    expect(calls[0]!.endMs - calls[0]!.startMs).toBeGreaterThanOrEqual(15);
  });

  it("reports a failure too (a request that timed out is exactly the time the caller waited) and rethrows the original error", async () => {
    const calls: UpstreamCall[] = [];
    const boom = new Error("boom");
    await expect(timedCall("vanilla", (call) => calls.push(call), async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(calls).toHaveLength(1);
  });

  it("never lets a throwing listener change the outcome", async () => {
    const listener = vi.fn(() => {
      throw new Error("listener bug");
    });
    await expect(timedCall("frm", listener, async () => "fine")).resolves.toBe("fine");
    await expect(timedCall("frm", listener, async () => Promise.reject(new Error("real")))).rejects.toThrow("real");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does nothing extra without a listener", async () => {
    await expect(timedCall("frm", undefined, async () => 7)).resolves.toBe(7);
  });
});

describe("the vanilla API client", () => {
  it("reports each call, success or failure, as vanilla", async () => {
    const calls: UpstreamCall[] = [];
    await vanilla(okTransport, (c) => calls.push(c)).call("HealthCheck");
    const failing = vanilla(async () => Promise.reject(new Error("down")), (c) => calls.push(c));
    await expect(failing.call("HealthCheck")).rejects.toThrow("down");
    expect(calls.map((c) => c.upstream)).toEqual(["vanilla", "vanilla"]);
  });

  it("reports an HTTP error answer too (the server did answer, after that long)", async () => {
    const calls: UpstreamCall[] = [];
    const client = vanilla(async () => ({ status: 500, body: undefined }), (c) => calls.push(c));
    await expect(client.call("HealthCheck")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("works without a listener", async () => {
    await expect(vanilla(okTransport).call("HealthCheck")).resolves.toEqual({ ok: true });
  });
});

describe("the FRM client", () => {
  const json = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

  it("reports one call as frm, covering the request up to the parsed body", async () => {
    const calls: UpstreamCall[] = [];
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response("[]", { status: 200 });
    };
    await frm(slow, (c) => calls.push(c)).get("getFactory");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.upstream).toBe("frm");
    expect(calls[0]!.endMs - calls[0]!.startMs).toBeGreaterThanOrEqual(15);
  });

  it("reports a network failure, an error status and an unparseable body", async () => {
    const calls: UpstreamCall[] = [];
    const onCall = (c: UpstreamCall) => calls.push(c);
    await expect(frm(async () => Promise.reject(new TypeError("fetch failed")), onCall).get("getFactory")).rejects.toThrow();
    await expect(frm(async () => new Response("no", { status: 500 }), onCall).get("getFactory")).rejects.toThrow();
    await expect(frm(async () => new Response("<html>", { status: 200 }), onCall).get("getFactory")).rejects.toThrow();
    expect(calls).toHaveLength(3);
  });

  it("returns the same data with or without a listener", async () => {
    const withListener = await frm(json([1, 2]), () => undefined).get("getFactory");
    const without = await frm(json([1, 2])).get("getFactory");
    expect(withListener).toEqual(without);
  });
});

describe("SatisfactoryServerAdapter.fromConfig", () => {
  it("passes the config's listener to both clients: a call to a closed port is still reported", async () => {
    const calls: UpstreamCall[] = [];
    const adapter = SatisfactoryServerAdapter.fromConfig({
      host: "127.0.0.1",
      apiPort: 9,
      apiAllowSelfSignedCert: true,
      frmPort: 9,
      requestTimeoutMs: 500,
      onUpstreamCall: (call) => calls.push(call),
    });
    await expect(adapter.getFactoryBuildings()).rejects.toThrow();
    await expect(adapter.getServerHealth()).rejects.toThrow();
    expect(new Set(calls.map((c) => c.upstream))).toEqual(new Set(["frm", "vanilla"]));
  });
});
