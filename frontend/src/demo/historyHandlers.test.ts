import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, HistoryItemsResponseSchema, HistoryTransitionsResponseSchema } from "@satisfactory-dash/shared";
import { resetDemoState } from "./handlers";
import { transport } from "./transport";
import { DEMO_SERVER_ID } from "./world";

// ADR-0027 PR 8b: the demo's history routes apply the same query schema the backend does, so a
// bad range or a bad limit is a 400 here too (handlers.ts). These hit the routes through the
// demo transport, not world.ts directly, so they exercise the query-string parsing itself.

const call = (path: string) => transport(path, { method: "GET", credentials: "include" });

const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  resetDemoState();
  fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not use the network")));
  vi.stubGlobal("fetch", fetchSpy);
  await transport(endpoints.auth.login.path(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "demo", password: "demo" }),
  });
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("the demo's history/items route", () => {
  it("defaults the range to 24h on a bare GET, like the contract says", async () => {
    const res = await call(endpoints.history.items.path(DEMO_SERVER_ID));
    expect(res.status).toBe(200);
    const body = HistoryItemsResponseSchema.parse(await res.json());
    expect(body.data.range).toBe("24h");
  });

  it("rejects a range the contract doesn't have", async () => {
    const res = await call(`${endpoints.history.items.path(DEMO_SERVER_ID)}?range=2w`);
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("bad_request");
  });

  it("filters to one item through the query string", async () => {
    const res = await call(`${endpoints.history.items.path(DEMO_SERVER_ID)}?range=24h&item=Desc_IronScrew_C`);
    const body = HistoryItemsResponseSchema.parse(await res.json());
    expect(body.data.series.map((s) => s.item)).toEqual(["Desc_IronScrew_C"]);
  });

  it("requires signing in first, like every other data route", async () => {
    resetDemoState();
    const res = await call(endpoints.history.items.path(DEMO_SERVER_ID));
    expect(res.status).toBe(401);
  });
});

describe("the demo's history/transitions route", () => {
  it("defaults range and limit on a bare GET", async () => {
    const res = await call(endpoints.history.transitions.path(DEMO_SERVER_ID));
    expect(res.status).toBe(200);
    const body = HistoryTransitionsResponseSchema.parse(await res.json());
    expect(body.data.range).toBe("24h");
  });

  it("rejects a range the contract doesn't have", async () => {
    const res = await call(`${endpoints.history.transitions.path(DEMO_SERVER_ID)}?range=2w`);
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("bad_request");
  });

  it("coerces a numeric limit and applies it", async () => {
    const res = await call(`${endpoints.history.transitions.path(DEMO_SERVER_ID)}?range=24h&limit=1`);
    const body = HistoryTransitionsResponseSchema.parse(await res.json());
    expect(body.data.transitions.length).toBeLessThanOrEqual(1);
  });

  it("rejects a limit that isn't a number", async () => {
    const res = await call(`${endpoints.history.transitions.path(DEMO_SERVER_ID)}?limit=abc`);
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("bad_request");
  });

  it("rejects a limit of 0, below the contract's minimum", async () => {
    const res = await call(`${endpoints.history.transitions.path(DEMO_SERVER_ID)}?limit=0`);
    expect(res.status).toBe(400);
  });

  it("rejects a limit above the contract's 500 cap", async () => {
    const res = await call(`${endpoints.history.transitions.path(DEMO_SERVER_ID)}?limit=501`);
    expect(res.status).toBe(400);
  });
});
